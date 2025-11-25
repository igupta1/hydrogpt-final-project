const logs = [];
let conversationId = null;
let isExtensionContextValid = true;
let intervalIds = [];

function checkExtensionContext() {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
      return true;
    }
  } catch (e) {
    console.warn('Extension context check failed:', e.message);
  }
  return false;
}

function saveToStorage(data) {
  try {
    if (!isExtensionContextValid || !checkExtensionContext()) {
      console.warn('Extension context invalidated, skipping storage save');
      return;
    }
    
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set(data, function() {
        if (chrome.runtime.lastError) {
          console.error("Chrome storage error:", chrome.runtime.lastError);
          if (chrome.runtime.lastError.message.includes("Extension context invalidated")) {
            console.warn('Extension context has been invalidated');
            isExtensionContextValid = false;
            intervalIds.forEach(id => clearInterval(id));
            intervalIds = [];
          }
        }
      });
    } else {
      console.warn("Chrome storage API not available");
    }
  } catch (e) {
    console.error("Storage error:", e);
  }
}

async function saveLog(userMessage, assistantResponse) {
  const userMessageKey = userMessage.substring(0, 100);
  const userTokenCount = Math.ceil(userMessage.length / 4);
  const assistantTokenCount = Math.ceil(assistantResponse.length / 4);
  const energyData = calculateEnergyAndEmissions(assistantTokenCount);
  const energyUsage = energyData.totalEnergy;
  const co2Emissions = energyData.co2Emissions;
  
  const existingLogIndex = logs.findIndex(log => 
    log.userMessage.substring(0, 100) === userMessageKey
  );
  
  let shouldUpdateNotification = false;
  
  if (existingLogIndex !== -1) {
    const existingLog = logs[existingLogIndex];
    
    if (assistantResponse.length > existingLog.assistantResponse.length || 
        (assistantResponse.length > 0 && existingLog.assistantResponse.length === 0)) {
      
      logs[existingLogIndex] = {
        ...existingLog,
        assistantResponse: assistantResponse,
        assistantTokenCount: assistantTokenCount,
        energyUsage: energyData.totalEnergy,
        co2Emissions: energyData.co2Emissions,
        lastUpdated: Date.now()
      };
      
      saveToStorage({ chatgptLogs: logs });
      shouldUpdateNotification = true;
    }
  } else {
    const logEntry = {
      timestamp: Date.now(),
      lastUpdated: Date.now(),
      url: window.location.href,
      conversationId: conversationId,
      userMessage: userMessage,
      assistantResponse: assistantResponse,
      userTokenCount: userTokenCount,
      assistantTokenCount: assistantTokenCount,
      energyUsage: energyUsage,
      co2Emissions: co2Emissions
    };
    
    logs.push(logEntry);
    saveToStorage({ chatgptLogs: logs });
    shouldUpdateNotification = true;
  }
  
  if (!document.getElementById('ai-impact-notification')) {
    createUsageNotification();
  } else {
    updateUsageNotification();
  }
}

async function scanMessages() {
  if (!isExtensionContextValid) {
    return false;
  }
  
  try {
    const userMessages = [...document.querySelectorAll('[data-message-author-role="user"]')];
    const assistantMessages = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    
    let foundMessages = userMessages.length > 0 && assistantMessages.length > 0;
    
    if (!foundMessages) {
      const alternativeUserSelectors = [
        '.markdown p',
        '[data-role="user"]', 
        '.user-message',
        '[data-testid="user-message"]',
        '.text-message-content'
      ];
      
      const alternativeAssistantSelectors = [
        '.markdown p',
        '[data-role="assistant"]',
        '.assistant-message', 
        '[data-testid="assistant-message"]',
        '.assistant-response'
      ];
      
      for (const userSelector of alternativeUserSelectors) {
        const altUserMessages = document.querySelectorAll(userSelector);
        if (altUserMessages.length > 0) {
          for (const assistantSelector of alternativeAssistantSelectors) {
            const altAssistantMessages = document.querySelectorAll(assistantSelector);
            if (altAssistantMessages.length > 0) {
              console.log(`Found alternative selectors: ${userSelector} (${altUserMessages.length}) and ${assistantSelector} (${altAssistantMessages.length})`);
              
              for (let i = 0; i < Math.min(altUserMessages.length, altAssistantMessages.length); i++) {
                try {
                  const userMessage = altUserMessages[i].textContent.trim();
                  const assistantResponse = altAssistantMessages[i].textContent.trim();
                  
                  if (userMessage && assistantResponse) {
                    await saveLog(userMessage, assistantResponse);
                    foundMessages = true;
                  }
                } catch (altMessageError) {
                  console.error("Error processing alternative message pair:", altMessageError);
                }
              }
              
              if (foundMessages) break;
            }
          }
          if (foundMessages) break;
        }
      }
    }
    
    if (userMessages.length > 0 || assistantMessages.length > 0) {
      console.log(`Found ${userMessages.length} user messages and ${assistantMessages.length} assistant messages`);
    }
    
    for (let i = 0; i < userMessages.length; i++) {
      if (i < assistantMessages.length) {
        try {
          const userMessage = userMessages[i].textContent.trim();
          const assistantResponse = assistantMessages[i].textContent.trim();
          
          if (userMessage) {
            await saveLog(userMessage, assistantResponse);
          }
        } catch (messageError) {
          console.error("Error processing message pair:", messageError);
        }
      }
    }
    
    return foundMessages;
  } catch (e) {
    console.error("Error scanning messages:", e);
    return false;
  }
}

function setupFetchInterceptor() {
  const originalFetch = window.fetch;
  
  window.fetch = async function(resource, init) {
    const url = resource instanceof Request ? resource.url : resource;
    const response = await originalFetch.apply(this, arguments);
    
    if (typeof url === 'string' && url.includes('conversation')) {
      try {
        const match = url.match(/\/c\/([a-zA-Z0-9-]+)/);
        if (match && match[1]) {
          conversationId = match[1];
        }
        
        if (response.headers.get('content-type')?.includes('text/event-stream')) {
          const clonedResponse = response.clone();
          
          (async () => {
            try {
              const reader = clonedResponse.body.getReader();
              const decoder = new TextDecoder();
              let buffer = '';
              let lastUpdateTime = 0;
              
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;
                
                const convoMatch = buffer.match(/"conversation_id":\s*"([^"]+)"/);
                if (convoMatch && convoMatch[1]) {
                  conversationId = convoMatch[1];
                }
                
                const now = Date.now();
                if (now - lastUpdateTime > 500) {
                  lastUpdateTime = now;
                  await scanMessages();
                  updateUsageNotification();
                }
                
                if (buffer.length > 100000) {
                  buffer = buffer.substring(buffer.length - 50000);
                }
              }
              
              setTimeout(async () => {
                await scanMessages();
                updateUsageNotification();
              }, 1000);
            } catch {
            }
          })();
        }
      } catch {
      }
    }
    
    return response;
  };
}

function setupObserver() {
  let lastUpdateTime = 0;
  
  const observer = new MutationObserver(async (mutations) => {
    let shouldScan = false;
    
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE && 
              (node.getAttribute('data-message-author-role') === 'assistant' || 
               node.querySelector('[data-message-author-role="assistant"]'))) {
            shouldScan = true;
            break;
          }
        }
      } else if (mutation.type === 'characterData') {
        shouldScan = true;
      }
      
      if (shouldScan) break;
    }
    
    if (shouldScan) {
      const now = Date.now();
      
      if (now - lastUpdateTime > 300) {
        lastUpdateTime = now;
        await scanMessages();
        updateUsageNotification();
      }
      
      setTimeout(async () => {
        await scanMessages();
        updateUsageNotification();
      }, 1000);
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

function createUsageNotification() {
  if (document.getElementById('ai-impact-notification')) {
    return;
  }
  
  const notification = document.createElement('div');
  notification.id = 'ai-impact-notification';
  notification.className = 'ai-impact-notification';
  
  const styles = document.createElement('style');
  styles.textContent = `
    .ai-impact-notification {
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background-color: white;
      color: #333;
      padding: 4px 12px;
      border-radius: 6px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      font-size: 12px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      transition: box-shadow 0.2s ease;
      cursor: pointer;
      line-height: 1.2;
      text-align: center;
      width: auto;
      min-width: auto;
      max-width: auto;
      height: auto;
      user-select: none;
    }

    .ai-impact-notification:hover {
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12);
    }

    .ai-impact-notification:active {
      transform: translateX(-50%) scale(0.98);
    }
    
    .ai-impact-content {
      text-align: center;
      white-space: nowrap;
      overflow: visible;
    }
    
    .ai-impact-message {
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .ai-impact-energy {
      font-weight: 500;
      display: inline;
      margin-left: 4px;
    }
    
    .ai-impact-emoji {
      margin: 0 4px 0 0;
      color: #3E7B67;
    }
    
    /* Make the notification adapt to the dark mode of ChatGPT */
    .dark .ai-impact-notification {
      background-color: #343541;
      color: #ECECF1;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    }
    
    /* Responsive adjustments */
    @media (max-width: 768px) {
      .ai-impact-notification {
        font-size: 11px;
        padding: 3px 10px;
      }
    }
    
    @media (max-width: 480px) {
      .ai-impact-notification {
        font-size: 10px;
        padding: 3px 8px;
      }
    }
  `;
  
  let message = "AI models have an environmental impact";
  
  notification.innerHTML = `
    <div class="ai-impact-content">
      <div id="ai-impact-message" class="ai-impact-message">${message}</div>
    </div>
  `;

  notification.addEventListener('click', () => {
    try {
      chrome.runtime.sendMessage({ action: "openDashboard" });
    } catch (e) {
      console.error("Failed to open dashboard:", e);
    }
  });
  
  try {
    if (document.head) {
      document.head.appendChild(styles);
    } else {
      console.warn("Document head not available for styles - will retry");
      setTimeout(() => {
        if (document.head) {
          document.head.appendChild(styles);
        }
      }, 500);
    }
  } catch (e) {
    console.error("Error appending styles:", e);
  }
  
  try {
    if (document.body) {
      document.body.appendChild(notification);
    } else {
      console.warn("Document body not available for notification insertion");
    }
  } catch (e) {
    console.error("Error inserting notification:", e);
  }

  const notificationObserver = new MutationObserver((mutations) => {
    if (!document.getElementById('ai-impact-notification')) {
      console.log('Notification was removed, recreating...');
      setTimeout(() => {
        if (!document.getElementById('ai-impact-notification')) {
          createUsageNotification();
        }
      }, 100);
    }
  });

  if (document.body) {
    notificationObserver.observe(document.body, {
      childList: true,
      subtree: false
    });
  }

  console.log("AI environmental impact notification added to page");
  updateUsageNotification();
}

function updateUsageNotification() {
  try {
    const messageElement = document.getElementById('ai-impact-message');
    
    if (!messageElement) {
      return;
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let todayLogs = [];
    let todayEnergyUsage = 0;
    let todayMessages = 0;
    
    try {
      if (Array.isArray(logs)) {
        todayLogs = logs.filter(log => {
          try {
            return log && log.timestamp && new Date(log.timestamp) >= today;
          } catch (dateError) {
            return false;
          }
        });
        
        todayMessages = todayLogs.length;
        
        todayLogs.forEach(log => {
          try {
            todayEnergyUsage += log.energyUsage || 0;
          } catch (energyError) {
          }
        });
      }
    } catch (logsError) {
      console.error("Error processing logs for notification:", logsError);
    }
    
    const formattedEnergy = todayEnergyUsage.toFixed(1);
    const updateTime = new Date().toLocaleTimeString();
    let message = `<span class="ai-impact-emoji">⚡️</span> <span class="ai-impact-energy">${formattedEnergy} Wh consumed today</span>`;
    
    console.log(`[${updateTime}] Updating energy notification: ${formattedEnergy} Wh`);
    
    try {
      messageElement.innerHTML = message;
    } catch (updateError) {
      console.error("Error updating notification message:", updateError);
    }
  } catch (error) {
    console.error("Error in updateUsageNotification:", error);
  }
}

function initialize() {
  initializeWithRetry(3);
  setInterval(validateAndRepairStorage, 5 * 60 * 1000);
  
  const setupUI = async () => {
    setupFetchInterceptor();
    setupObserver();
    await scanMessages();
    
    if (!document.getElementById('ai-impact-notification')) {
      createUsageNotification();
    }
  };
  
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(setupUI, 1000);
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(setupUI, 1000);
    });
  }
  
  let lastUrl = window.location.href;
  const urlMonitorInterval = setInterval(() => {
    if (lastUrl !== window.location.href) {
      lastUrl = window.location.href;
      
      try {
        const match = window.location.href.match(/\/c\/([a-zA-Z0-9-]+)/);
        if (match && match[1]) {
          conversationId = match[1];
        }
      } catch {
      }
      
      setTimeout(async () => await scanMessages(), 1000);
    }
  }, 1000);
  intervalIds.push(urlMonitorInterval);
  
  setInterval(() => {
    if (document.getElementById('ai-impact-notification')) {
      updateUsageNotification();
    } else {
      createUsageNotification();
    }
  }, 2 * 60 * 1000);
}


function reloadLogsFromStorage() {
  return new Promise((resolve) => {
    if (!checkExtensionContext()) {
      resolve();
      return;
    }
    
    try {
      chrome.storage.local.get(['chatgptLogs'], function(result) {
        if (chrome.runtime.lastError) {
          console.error('Error reloading logs from storage:', chrome.runtime.lastError);
          resolve();
        } else {
          const storedLogs = result.chatgptLogs || [];
          logs.length = 0;
          logs.push(...storedLogs);
          console.log(`Reloaded ${logs.length} logs from storage`);
          resolve();
        }
      });
    } catch (error) {
      console.error('Error accessing storage for log reload:', error);
      resolve();
    }
  });
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "updateNotification") {
        if (message.enabled) {
          if (!document.getElementById('ai-impact-notification')) {
            createUsageNotification();
          }
        } else {
          const notification = document.getElementById('ai-impact-notification');
          if (notification) {
            notification.parentNode.removeChild(notification);
          }
        }
        return true;
      }
    });
  } catch (e) {
    console.warn('Failed to add message listener:', e);
  }
}

function validateAndRepairStorage() {
  if (!isExtensionContextValid || !checkExtensionContext()) {
    console.log('Extension context invalidated, skipping storage validation');
    return;
  }
  
  console.log("Running storage validation check...");
  
  try {
    chrome.storage.local.get(['chatgptLogs', 'extensionVersion'], (result) => {
    if (chrome.runtime.lastError) {
      console.error("Error checking storage:", chrome.runtime.lastError);
      return;
    }
    
    let needsRepair = false;
    
    if (!result.chatgptLogs || !Array.isArray(result.chatgptLogs)) {
      console.warn("Invalid logs format in storage, needs repair");
      needsRepair = true;
    }
    
    if (!result.extensionVersion) {
      console.warn("Missing extension version in storage, will repair");
      needsRepair = true;
    }
    
    if (needsRepair) {
      if (logs && Array.isArray(logs) && logs.length > 0) {
        console.log("Repairing storage with in-memory logs");
        chrome.storage.local.set({ 
          chatgptLogs: logs,
          extensionVersion: chrome.runtime.getManifest().version
        });
      } else {
        console.log("Initializing fresh logs in storage");
        chrome.storage.local.set({ 
          chatgptLogs: [],
          extensionVersion: chrome.runtime.getManifest().version
        });
      }
    } else {
      console.log("Storage validation passed - data is healthy");
    }
  });
  } catch (e) {
    console.error('Error accessing Chrome storage:', e);
    if (e.message && e.message.includes('Extension context invalidated')) {
      isExtensionContextValid = false;
      intervalIds.forEach(id => clearInterval(id));
      intervalIds = [];
    }
  }
}

function initializeWithRetry(retryCount = 3) {
  console.log(`Initializing with ${retryCount} retries remaining`);
  try {
    chrome.storage.local.get(['chatgptLogs', 'extensionVersion'], (result) => {
      if (chrome.runtime.lastError) {
        console.error("Error loading logs:", chrome.runtime.lastError);
        
        if (chrome.runtime.lastError.message && 
            chrome.runtime.lastError.message.includes('Extension context invalidated')) {
          console.warn('Extension context invalidated during initialization');
          isExtensionContextValid = false;
          intervalIds.forEach(id => clearInterval(id));
          intervalIds = [];
          return;
        }
        
        if (retryCount > 0) {
          console.log(`Retrying in 1 second (${retryCount} attempts left)...`);
          setTimeout(() => initializeWithRetry(retryCount - 1), 1000);
          return;
        }
      }
      
      const currentVersion = chrome.runtime.getManifest().version;
      const storedVersion = result.extensionVersion || '0.0';
      console.log(`Extension version: Current=${currentVersion}, Stored=${storedVersion}`);
      
      if (result && result.chatgptLogs && Array.isArray(result.chatgptLogs)) {
        try {
          logs.length = 0;
          logs.push(...result.chatgptLogs);
          console.log(`Loaded ${result.chatgptLogs.length} conversation logs`);
        } catch (arrayError) {
          console.error("Error adding logs to array:", arrayError);
          logs.length = 0;
        }
      } else {
        console.log("No existing logs found or invalid format, starting fresh");
        logs.length = 0;
      }
      
      setTimeout(createUsageNotification, 500);
    });
  } catch (e) {
    console.error("Critical initialization error:", e);
    
    if (e.message && e.message.includes('Extension context invalidated')) {
      console.warn('Extension context invalidated during initialization');
      isExtensionContextValid = false;
      intervalIds.forEach(id => clearInterval(id));
      intervalIds = [];
      return;
    }
    
    if (retryCount > 0) {
      console.log(`Retrying in 1 second (${retryCount} attempts left)...`);
      setTimeout(() => initializeWithRetry(retryCount - 1), 1000);
    } else {
      logs.length = 0;
      setTimeout(createUsageNotification, 500);
    }
  }
}

window.addEventListener('beforeunload', () => {
  intervalIds.forEach(id => clearInterval(id));
  intervalIds = [];
});

initialize();