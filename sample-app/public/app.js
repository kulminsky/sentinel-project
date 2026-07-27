console.error(
  "Intentional sample error: the optional analytics widget did not initialize.",
);

const form = document.querySelector("#subscription-form");
const status = document.querySelector("#form-status");

form?.addEventListener("submit", (event) => {
  event.preventDefault();

  if (status !== null) {
    status.textContent = "Thanks for subscribing.";
  }
});
