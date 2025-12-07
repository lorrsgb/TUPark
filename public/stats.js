const ctx = document.getElementById("statsChart").getContext("2d");

let statsChart = new Chart(ctx, {
  type: "line",
  data: {
    labels: [],
    datasets: [{
      label: "Occupancy",
      data: [],
      borderWidth: 3
    }]
  },
  options: {
    responsive: true,
    scales: {
      y: { beginAtZero: true }
    }
  }
});

// Load statistics
async function loadStats(range) {
  const res = await fetch(`/api/stats?range=${range}`);
  const data = await res.json();

  // Update Chart
  statsChart.data.labels = data.labels;
  statsChart.data.datasets[0].data = data.values;
  statsChart.update();

  // Update Summary Table
  document.getElementById("stats-summary-body").innerHTML = `
    <tr>
      <td>${range.toUpperCase()}</td>
      <td>${data.peak}</td>
      <td>${data.slow}</td>
      <td>${data.average}%</td>
    </tr>
  `;
}

// Tab Switching
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelector(".tab-btn.active")?.classList.remove("active");
    btn.classList.add("active");
    loadStats(btn.dataset.range);
  });
});

// Default load
loadStats("daily");
