console.log("stats.js loaded");

// Chart instance
let chart = null;

async function loadStats(range) {
    try {
        const res = await fetch(`/api/stats?range=${range}`);
        const data = await res.json();

        const ctx = document.getElementById("statsChart").getContext("2d");

        if (chart) chart.destroy();

        chart = new Chart(ctx, {
            type: "line",
            data: {
                labels: data.labels,
                datasets: [{
                    label: `${range.toUpperCase()} Occupancy`,
                    data: data.values,
                    borderWidth: 2,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });

        // Fill summary table
        document.getElementById("stats-summary-body").innerHTML = `
            <tr>
                <td>${range.toUpperCase()}</td>
                <td>${data.peak}</td>
                <td>${data.slow}</td>
                <td>${data.average}</td>
            </tr>
        `;

    } catch (err) {
        console.error("Stats Load Error:", err);
    }
}

// Tab Buttons
document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelector(".tab-btn.active").classList.remove("active");
        btn.classList.add("active");

        const selected = btn.dataset.range;
        loadStats(selected);
    });
});

// Load daily on startup
loadStats("daily");
