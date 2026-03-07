module.exports = {
  apps: [{
    name: "voice-bot",
    script: "./src/server.js",
    watch: false,
    max_memory_restart: "1G",
    env: {
      NODE_ENV: "production",
    }
  }]
}
