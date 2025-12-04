const btn = document.getElementById("demo-btn");
const car = document.getElementById("car");

// Fade-in when this page first loads
window.addEventListener("load", () => {
  document.body.classList.add("fade-in");
});

btn.addEventListener("click", () => {
  // Start car animation
  car.classList.add("move");

  // Wait for car animation (2.5s)
  setTimeout(() => {
    // Trigger fade-out
    document.body.classList.add("fade-out");

    // After fade-out, go to next page
    setTimeout(() => {
      window.location.href = "/demo";
    }, 800); // matches fade-out transition
  }, 2500);
});

