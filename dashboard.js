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
  
  // Update comparisons
  updateComparisons('today', todayEnergyUsage);
  
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
  
  // Update comparisons
  
  updateComparisons('lifetime', totalEnergyUsage);
}

function updateComparisons(period, whUsed) {
  // Conversion factors based on commonly cited standards (US averages):
  
  // 1. CO2: US average grid carbon intensity (0.81 lbs/kWh -> 367 g/kWh)
  const CO2_GRAMS_PER_KWH = 367; 
  
  // 2. Miles Driven: Factor derived from CO2 equivalence (1 kWh saved offsets CO2 of 0.67 miles driven)
  const MILES_PER_KWH_EQUIVALENT = 0.67; 
  
  // 3. Trees: Annual absorption of a mature tree (Inverse of 22 kg CO2 per year)
  // This factor is used to find the fraction of a mature tree's annual work
  const MATURE_TREES_PER_KG_CO2 = 1 / 22; // approx 0.045
  
  // 4. Water: Water consumption for power plant cooling (Standard industrial estimate)
  const WATER_LITERS_PER_KWH = 2.2; 
  
  const kwh = whUsed / 1000; // convert watt-hours to kilowatt-hours
  
  // Calculate comparisons
  
  // 1. CO2 (grams)
  const co2grams = (kwh * CO2_GRAMS_PER_KWH).toFixed(0);
  
  // 2. Miles Driven (equivalent)
  const milesDriven = (kwh * MILES_PER_KWH_EQUIVALENT).toFixed(2);
  
  // 3. Mature Trees (fraction of annual absorption)
  // Convert grams to kg for this calculation:
  const co2kg = (kwh * CO2_GRAMS_PER_KWH) / 1000;
  const treesNeeded = (co2kg * MATURE_TREES_PER_KG_CO2).toFixed(3); // Show 3 decimal places for a fraction
  
  // 4. Water Liters
  const waterLiters = (kwh * WATER_LITERS_PER_KWH).toFixed(2);
  
  // Update DOM
  document.getElementById(`${period}-comparison-1`).textContent = co2grams;
  document.getElementById(`${period}-comparison-2`).textContent = milesDriven;
  document.getElementById(`${period}-comparison-3`).textContent = treesNeeded;
  document.getElementById(`${period}-comparison-4`).textContent = waterLiters;
}

function formatNumber(num, isEnergy = false) {
  const value = parseFloat(num);
  
  if (isEnergy && value >= 1000) {
    return (value / 1000).toFixed(1) + 'k';
  }
  
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

