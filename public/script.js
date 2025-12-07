const btn = document.getElementById("login-btn");
const car = document.getElementById("car");
const adminInput = document.getElementById("admin-id");
const passInput = document.getElementById("password");

// Fade-in when this page first loads
window.addEventListener("load", () => {
  document.body.classList.add("fade-in");
});

btn.addEventListener("click", (e) => {
  e.preventDefault(); // Stop the form from refreshing the page

  // 1. Get values from the input fields
  const adminId = adminInput.value;
  const password = passInput.value;

  // 2. Send data to our new Server
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
          // This will now show: "Invalid Account. 2 attempts remaining." 
          // OR "Account Locked. Try again in 30 seconds."
          alert(data.message);
      }
  })
  .catch(error => {
      console.error('Error:', error);
      alert("System Error. Please try again.");
  });
});
// ==============================
// LOAD OCCUPANCY STATISTICS
// ==============================
// =====================================
// LOAD USAGE STATISTICS
// =====================================
async function loadUsageStatistics(range = "daily") {
    try {
        const response = await fetch(`/api/stats?range=${range}`);
        const data = await response.json();

        const canvas = document.getElementById("usageStatsChart");
        if (!canvas) return;

        const ctx = canvas.getContext("2d");

        if (window.usageChart) window.usageChart.destroy();

        window.usageChart = new Chart(ctx, {
            type: "line",
            data: {
                labels: data.labels,
                datasets: [{
                    label: `${range} Occupancy`,
                    data: data.values,
                    borderWidth: 3,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
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
        console.error("Stats Error:", err);
    }
}

// Default load when modal opens
function openLogsModal() {
    logsModal.classList.add('show-modal');
    fetchLogs();
    loadUsageStatistics("daily");  // load stats
}

// Stats tab switching
document.addEventListener("click", (e) => {
    if (e.target.classList.contains("stats-tab")) {
        document.querySelectorAll(".stats-tab").forEach(tab => tab.classList.remove("active"));
        e.target.classList.add("active");
        loadUsageStatistics(e.target.dataset.range);
    }
});
