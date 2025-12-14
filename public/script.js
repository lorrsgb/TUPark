const btn = document.getElementById("login-btn");
const car = document.getElementById("car");
const adminInput = document.getElementById("admin-id");
const passInput = document.getElementById("password");

// --- NEW CHART VARIABLES & ELEMENTS ---
// These variables will hold the Chart.js instances for dynamic updates.
let dailyChart, weeklyChart, monthlyChart; 
// Assuming the modal element has the ID 'charts-modal'
const chartsModal = document.getElementById("charts-modal"); 
// Selector for the link that opens the charts modal (e.g., the 'Statistics' link)
const statisticsLink = document.querySelector('nav ul li a[href="/admin#charts"]'); 

// Fade-in when this page first loads
window.addEventListener("load", () => {
  document.body.classList.add("fade-in");
});

// ==========================================
// LOGIN LOGIC
// ==========================================
btn.addEventListener("click", (e) => {
  e.preventDefault(); // Stop the form from refreshing the page

  // 1. Get values from the input fields
  const adminId = adminInput.value;
  const password = passInput.value;

  // 2. Send data to the server
  fetch('/login', {
      method: 'POST',
      headers: {
          'Content-Type': 'application/json'
      },
      body: JSON.stringify({ adminId: adminId, password: password })
  })
  .then(response => response.json())
  .then(data => {
      if (data.success) {
          // 3. IF SUCCESS: Play animation and redirect
          console.log("Login Approved!");
          car.classList.add("move");

          setTimeout(() => {
            document.body.classList.add("fade-out");
            setTimeout(() => {
              // Redirect to the SERVER ROUTE '/admin'
              window.location.href = "/admin"; 
            }, 800); 
          }, 2500);

      } else {
          // 4. IF FAIL: Show the specific Security Message
          alert(data.message);
      }
  })
  .catch(error => {
      console.error('Error:', error);
      alert("System Error. Please try again.");
  });
});


// ==========================================
// NEW: CHART LOGIC FOR ADMIN DASHBOARD
// ==========================================

// --- Function to load and render all three charts ---
async function loadOccupancyCharts() {
    try {
        // Fetch data for all three charts concurrently
        const dailyDataPromise = fetch('/api/charts/daily').then(res => res.json());
        const weeklyDataPromise = fetch('/api/charts/weekly').then(res => res.json());
        const monthlyDataPromise = fetch('/api/charts/monthly').then(res => res.json());

        const [dailyResult, weeklyResult, monthlyResult] = await Promise.all([
            dailyDataPromise, 
            weeklyDataPromise, 
            monthlyDataPromise
        ]);

        // Destroy old charts to prevent duplicate rendering
        if (dailyChart) dailyChart.destroy();
        if (weeklyChart) weeklyChart.destroy();
        if (monthlyChart) monthlyChart.destroy();
        
        // ============================
        // DAILY OCCUPANCY CHART (Bar Chart: Last 24 Hours)
        // ============================
        const dailyCtx = document.getElementById("dailyOccupancyChart").getContext("2d");
        const dailyLabels = dailyResult.map(row => `${row.hour_label}:00`);
        const occupiedData = dailyResult.map(row => parseInt(row.occupied_count, 10));
        const releasedData = dailyResult.map(row => parseInt(row.released_count, 10));

        dailyChart = new Chart(dailyCtx, {
            type: 'bar',
            data: {
                labels: dailyLabels,
                datasets: [
                    {
                        label: 'Occupied Spots',
                        data: occupiedData,
                        backgroundColor: 'rgba(0, 123, 255, 0.7)',
                        borderColor: 'rgba(0, 123, 255, 1)',
                        borderWidth: 1
                    },
                    {
                        label: 'Released Spots',
                        data: releasedData,
                        backgroundColor: 'rgba(239, 68, 68, 0.7)',
                        borderColor: 'rgba(239, 68, 68, 1)',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, title: { display: true, text: 'Number of Events' } },
                    x: { title: { display: true, text: 'Time (Last 24 Hours)' } }
                }
            }
        });


        // ============================
        // WEEKLY OCCUPANCY CHART (Line Chart: Last 7 Days)
        // ============================
        const weeklyCtx = document.getElementById("weeklyOccupancyChart").getContext("2d");
        weeklyChart = new Chart(weeklyCtx, {
            type: 'line', 
            data: {
                labels: weeklyResult.map(row => row.day_label),
                datasets: [{
                    label: 'Avg. Occupied Slots (per Day)',
                    data: weeklyResult.map(row => parseInt(row.occupied_slots_count, 10)),
                    borderColor: '#22c55e',
                    backgroundColor: 'rgba(34, 197, 94, 0.2)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, title: { display: true, text: 'Number of Unique Slots Occupied' } },
                    x: { title: { display: true, text: 'Day of Week' } }
                }
            }
        });
        
        // ============================
        // MONTHLY OCCUPANCY CHART (Line Chart: Last 12 Months)
        // ============================
        const monthlyCtx = document.getElementById("monthlyOccupancyChart").getContext("2d");
        monthlyChart = new Chart(monthlyCtx, {
            type: 'line', 
            data: {
                labels: monthlyResult.map(row => row.month_label),
                datasets: [{
                    label: 'Avg. Daily Occupancy',
                    data: monthlyResult.map(row => parseInt(row.average_occupied_slots, 10)),
                    borderColor: '#facc15',
                    backgroundColor: 'rgba(250, 204, 21, 0.2)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, title: { display: true, text: 'Average Occupied Slots' } },
                    x: { title: { display: true, text: 'Month' } }
                }
            }
        });

    } catch (error) {
        console.error("Error loading all charts:", error);
        alert("Failed to load occupancy statistics charts.");
    }
}

// --- Event Listener to load charts when the Statistics link is clicked ---
if (statisticsLink) {
    statisticsLink.addEventListener('click', (e) => {
        e.preventDefault();
        
        // In a real application, you would add code here to display the modal 
        // (e.g., chartsModal.classList.add("show-modal");)
        
        // Load the data and render the charts
        loadOccupancyCharts(); 
    });
}


// ==========================================
// LOAD USAGE STATISTICS (Existing code preserved for compatibility)
// ==========================================
let usageChart; // Define the chart variable globally for loadUsageStatistics to use
async function loadUsageStatistics(range) {
    try {
        // NOTE: This assumes an API endpoint /api/stats?range=... is available
        const response = await fetch(`/api/stats?range=${range}`);
        const data = await response.json();

        const canvas = document.getElementById("usageStatsChart");
        const ctx = canvas.getContext("2d");

        if (usageChart) usageChart.destroy();

        usageChart = new Chart(ctx, {
            type: "line",
            data: {
                labels: data.labels,
                datasets: [{
                    label: `${range.toUpperCase()} Occupancy`,
                    data: data.values,
                    borderWidth: 3,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });

        document.getElementById("usage-stats-summary").innerHTML = `
            <tr>
                <td>${range}</td>
                <td>${data.peak}</td>
                <td>${data.slow}</td>
                <td>${data.average}</td>
            </tr>
        `;

    } catch (err) {
        console.error("Error loading stats:", err);
    }
}

/* TAB CLICK HANDLERS */
document.addEventListener("click", e => {
    if (!e.target.classList.contains("stats-tab")) return;

    document.querySelectorAll(".stats-tab").forEach(b => b.classList.remove("active"));
    e.target.classList.add("active");

    // Check if the old usageStatsChart element exists before trying to load
    if(document.getElementById("usageStatsChart")) {
        loadUsageStatistics(e.target.dataset.range);
    }
});