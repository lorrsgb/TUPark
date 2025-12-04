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