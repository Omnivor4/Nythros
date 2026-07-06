import os from "node:os";

export function getSystemInfo() {
  return {
    platform: os.platform(),
    cpus: os.cpus().length,
    totalMemGB: Math.round(os.totalmem() / 1024 / 1024 / 1024),
    freeMemGB: Math.round(os.freemem() / 1024 / 1024 / 1024),
    uptime: os.uptime(),
    userInfo: os.userInfo().username
  };
}
