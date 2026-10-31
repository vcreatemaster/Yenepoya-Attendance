export async function api(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const res = await fetch("/api" + path, {
    ...options,
    headers: {
      "X-Requested-With": "Yenepoya",
      ...(options.body && !isForm
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
    body: options.body && !isForm ? JSON.stringify(options.body) : options.body,
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && path !== "/auth/login")
      window.dispatchEvent(new Event("session-expired"));
    throw new Error(data.error || "Request failed");
  }
  return data;
}
export const roleName = (r) =>
  ({
    master_admin: "Master administrator",
    admin: "Academic administrator",
    teacher: "Faculty",
    welfare: "Student welfare officer",
    student: "Student",
  })[r];
export const admin = (u) => ["admin", "master_admin"].includes(u.role);
export const dateLabel = (d) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
export const initials = (n) =>
  n
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("");
