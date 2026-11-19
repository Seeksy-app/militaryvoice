const who = document.getElementById("who");
chrome.runtime.sendMessage({ type: "me" }, (r) => {
  if (r && r.ok) who.textContent = `Signed in as ${r.me.email}${r.me.show ? " · " + r.me.show : ""}`;
  else who.textContent = "Not signed in. Open militaryvoices.ai and sign in.";
});
for (const id of ["capture", "prep"]) {
  document.getElementById(id).addEventListener("click", () => chrome.runtime.sendMessage({ type: id }, () => window.close()));
}
