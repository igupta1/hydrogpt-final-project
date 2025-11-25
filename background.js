chrome.runtime.onInstalled.addListener((details) => {
  console.log("See How Your AI Usage Impacts the Environment installation type:", details.reason);
  
  if (details.reason === 'install') {
    console.log("Fresh install - initializing storage");
    chrome.storage.local.set({ 
      chatgptLogs: [], 
      extensionVersion: chrome.runtime.getManifest().version 
    });
  } else if (details.reason === 'update') {
    console.log("Extension update detected - preserving data");
    
    try {
      chrome.storage.local.get(['chatgptLogs', 'extensionVersion'], (result) => {
        if (chrome.runtime.lastError) {
          console.error("Error accessing storage during update:", chrome.runtime.lastError);
          return;
        }

        const oldVersion = result.extensionVersion || '0.0';
        const newVersion = chrome.runtime.getManifest().version;
        
        console.log(`Updating from version ${oldVersion} to ${newVersion}`);
        console.log("Existing data:", {
          hasLogs: !!result.chatgptLogs,
          logsIsArray: Array.isArray(result.chatgptLogs),
          logsCount: Array.isArray(result.chatgptLogs) ? result.chatgptLogs.length : 0
        });
        
        if (!result.chatgptLogs || !Array.isArray(result.chatgptLogs)) {
          console.warn("Invalid logs format detected during update, repairing...");
          chrome.storage.local.set({ 
            chatgptLogs: [], 
            extensionVersion: newVersion 
          });
        } else {
          chrome.storage.local.set({ 
            extensionVersion: newVersion 
          });
        }
      });
    } catch (err) {
      console.error("Critical error during update:", err);
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "openDashboard") {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
    console.log("Opened dashboard in new tab");
    return true;
  }
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  console.log("Extension icon clicked - opened dashboard");
});