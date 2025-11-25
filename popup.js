const getChromeStorage = () => {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
  } catch (e) {
    console.error("Error accessing chrome storage API:", e);
  }
  return null;
};

function cleanupEmailStorage() {
  const storage = getChromeStorage();
  if (storage) {
    storage.remove([
      'userEmail',
      'emailConsent',
      'emailConsentDate',
      'marketingConsent',
      'marketingConsentDate'
    ], function() {
      console.log('Email storage cleanup completed (Issue #15)');
    });
  }
}

document.addEventListener('DOMContentLoaded', function() {
  try {
    cleanupEmailStorage();

    document.getElementById('lifetime-tab').addEventListener('click', function() {
      switchTab('lifetime');
    });

    document.getElementById('today-tab').addEventListener('click', function() {
      switchTab('today');
    });

    adjustPopupHeight();
    updateTodayStats([]);
    updateLifetimeStats([]);
    loadLogs();
  } catch(err) {
    console.error("Error initializing popup:", err);
  }
});

function adjustPopupHeight() {
  let rafId = null;
  let lastHeight = 0;
  let resizeObserver = null;
  
  const processResize = () => {
    rafId = null;
    
    const activeTab = document.querySelector('.stats-container.active');
    if (!activeTab) return;
    
    const currentScrollHeight = document.body.scrollHeight;
    
    if (currentScrollHeight !== lastHeight && currentScrollHeight > window.innerHeight) {
      lastHeight = currentScrollHeight;
      
      if (resizeObserver) {
        resizeObserver.disconnect();
        setTimeout(() => {
          resizeObserver.observe(document.body);
        }, 100);
      }
    }
  };
  
  resizeObserver = new ResizeObserver(() => {
    if (!rafId) {
      rafId = requestAnimationFrame(processResize);
    }
  });
  
  resizeObserver.observe(document.body);
  window._popupResizeObserver = resizeObserver;
}

function switchTab(tabId) {
  document.querySelectorAll('.stats-container').forEach(container => {
    container.classList.remove('active');
  });
  
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.remove('active');
  });
  
  document.getElementById(`${tabId}-stats`).classList.add('active');
  document.getElementById(`${tabId}-tab`).classList.add('active');
}

function loadLogs() {
  try {
    const storage = getChromeStorage();
    if (!storage) {
      console.warn('Chrome storage API not available - showing empty stats');
      return;
    }
    
    storage.get(['chatgptLogs', 'extensionVersion'], function(result) {
      const lastError = chrome.runtime && chrome.runtime.lastError;
      if (lastError) {
        console.error('Error loading logs:', lastError);
        setTimeout(() => {
          console.log('Retrying log load after error...');
          tryLoadLogsAgain();
        }, 500);
        return;
      }
      
      const logs = result.chatgptLogs || [];
      const version = result.extensionVersion || 'unknown';
      console.log(`Loaded ${logs.length} logs from storage (extension version: ${version})`);
      
      if (!Array.isArray(logs)) {
        console.error('Invalid logs format in storage!');
        updateTodayStats([]);
        updateLifetimeStats([]);
        
        chrome.storage.local.set({ 
          chatgptLogs: [],
          extensionVersion: chrome.runtime.getManifest().version 
        });
        return;
      }
      
      if (logs.length > 0) {
        console.log('First log:', logs[0]);
        console.log('Last log:', logs[logs.length - 1]);
        
        const totalEnergy = logs.reduce((sum, log) => sum + (log.energyUsage || 0), 0);
        console.log(`Total energy usage in logs: ${totalEnergy.toFixed(2)} Wh`);
        
        const logsWithoutEnergy = logs.filter(log => log.energyUsage === undefined || log.energyUsage === null);
        if (logsWithoutEnergy.length > 0) {
          console.warn(`${logsWithoutEnergy.length} logs have missing energy usage values`);
        }
      }
      
      updateTodayStats(logs);
      updateLifetimeStats(logs);
    });
  } catch (e) {
    console.error('Error in loadLogs:', e);
    updateTodayStats([]);
    updateLifetimeStats([]);
  }
}

function tryLoadLogsAgain() {
  try {
    const storage = getChromeStorage();
    if (!storage) {
      console.warn('Chrome storage API not available in retry attempt');
      return;
    }
    
    storage.get('chatgptLogs', function(result) {
      if (!result) {
        console.warn('No result from storage in retry');
        return;
      }
      
      const logs = Array.isArray(result.chatgptLogs) ? result.chatgptLogs : [];
      console.log(`Retry loaded ${logs.length} logs from storage`);
      
      updateTodayStats(logs);
      updateLifetimeStats(logs);
    });
  } catch (e) {
    console.error('Error in retry loadLogs:', e);
  }
}

function updateTodayStats(logs) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const todayLogs = logs.filter(log => new Date(log.timestamp) >= today);
  
  let todayMessages = todayLogs.length;
  let todayEnergyUsage = 0;
  
  if (todayLogs.length === 0) {
    todayEnergyUsage = 0;
  } else {
    todayLogs.forEach(log => {
      const logEnergy = log.energyUsage || 0;
      todayEnergyUsage += logEnergy;
    });
    
    todayEnergyUsage = todayEnergyUsage;
  }
  
  document.getElementById('today-messages').textContent = formatNumber(todayMessages);
  document.getElementById('today-energy').textContent = formatNumber(todayEnergyUsage.toFixed(2), true);
}

function updateLifetimeStats(logs) {
  let totalMessages = logs.length;
  let totalEnergyUsage = 0;
  
  if (logs.length === 0) {
    totalEnergyUsage = 0;
  } else {
    logs.forEach(log => {
      const logEnergy = log.energyUsage || 0;
      totalEnergyUsage += logEnergy;
    });
    
    totalEnergyUsage = totalEnergyUsage;
  }
  
  document.getElementById('lifetime-messages').textContent = formatNumber(totalMessages);
  document.getElementById('lifetime-energy').textContent = formatNumber(totalEnergyUsage.toFixed(2), true);
}

function formatNumber(num, isEnergy = false) {
  const value = parseFloat(num);
  
  if (isEnergy && value >= 1000) {
    return (value / 1000).toFixed(1) + 'k';
  }
  
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
