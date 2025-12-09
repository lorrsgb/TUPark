const car = document.getElementById("car");
const manualLoginForm = document.getElementById("manual-login-form"); // Targeting the form
const emailInput = document.getElementById("manual-email");
const passInput = document.getElementById("manual-password");

// Fade-in when this page first loads
window.addEventListener("load", () => {
  document.body.classList.add("fade-in");
});

// --- MANUAL LOGIN SUBMISSION LOGIC ---
manualLoginForm.addEventListener("submit", (e) => { // Listening to form submit event
  e.preventDefault(); 

  const email = emailInput.value;
  const password = passInput.value;

  fetch('/manual-login', { 
      method: 'POST',
      headers: {
          'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: email, password: password }) 
  })
  .then(response => {
       // Handle 401/500 errors gracefully
      if (!response.ok) {
          return response.json().then(errorData => {
              throw new Error(errorData.message || 'Login failed.');
          });
      }
      return response.json();
  })
  .then(data => {
      if (data.success) {
          console.log("Manual Login Approved!");
          car.classList.add("move");

          setTimeout(() => {
            document.body.classList.add("fade-out");
            setTimeout(() => {
              // Redirect to the server-provided redirect URL (e.g., /admin)
              window.location.href = data.redirect || "/admin"; 
            }, 800); 
          }, 2500);

      } 
  })
  .catch(error => {
      console.error('Error:', error.message);
      alert(`Login Error: ${error.message}`);
  });
});
// --- END MANUAL LOGIN SUBMISSION LOGIC ---


// =====================================
// LOAD USAGE STATISTICS (Retained)
// =====================================
let usageChart; 

async function loadUsageStatistics(range) {
    try {
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

    loadUsageStatistics(e.target.dataset.range);
});