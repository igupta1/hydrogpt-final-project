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

document.addEventListener('DOMContentLoaded', function() {
  try {
    document.getElementById('lifetime-tab').addEventListener('click', function() {
      switchTab('lifetime');
    });

    document.getElementById('today-tab').addEventListener('click', function() {
      switchTab('today');
    });

    document.getElementById('methodology-tab').addEventListener('click', function() {
      switchTab('methodology');
    });

    document.getElementById('learn-more-tab').addEventListener('click', function() {
      switchTab('learn-more');
    });

    updateTodayStats([]);
    updateLifetimeStats([]);
    loadLogs();
  } catch(err) {
    console.error("Error initializing dashboard:", err);
  }
});

function switchTab(tabId) {
  document.querySelectorAll('.content-section').forEach(container => {
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
        return;
      }
      
      const logs = result.chatgptLogs || [];
      const version = result.extensionVersion || 'unknown';
      console.log(`Loaded ${logs.length} logs from storage (extension version: ${version})`);
      
      if (!Array.isArray(logs)) {
        console.error('Invalid logs format in storage!');
        updateTodayStats([]);
        updateLifetimeStats([]);
        return;
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

