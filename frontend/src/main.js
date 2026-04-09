import { getHealth } from "./api/index.js";

const el = document.getElementById("api-health");

async function boot() {
  try {
    const data = await getHealth();
    el.textContent = data?.status === "ok" ? "connected" : JSON.stringify(data);
    el.classList.add("ok");
  } catch (e) {
    el.textContent = e?.message ?? String(e);
    el.classList.add("err");
  }
}

boot();
