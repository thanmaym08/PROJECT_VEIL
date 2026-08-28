# VEIL Deployment Guide

This guide details how to deploy the VEIL in-memory stateless relay server for production use, including reverse proxy configurations and Tor Hidden Service setup for metadata anonymity.

## 1. Running the Relay Server

The relay server is a lightweight Node.js process requiring no database.

```bash
cd server
npm install
node server.js
```

The server binds to port 8080 by default.

## 2. Reverse Proxy with TLS (Caddy)

To secure the WebSocket connection (`wss://`), use a reverse proxy like Caddy to automatically provision TLS certificates.

**Caddyfile:**
```caddyfile
veil.yourdomain.com {
    reverse_proxy localhost:8080
}
```

## 3. Reverse Proxy with TLS (Nginx)

If using Nginx, configure it to handle WebSocket upgrades:

**nginx.conf:**
```nginx
server {
    listen 443 ssl;
    server_name veil.yourdomain.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
```

## 4. Deploying as a Tor Hidden Service (Maximum Privacy)

To eliminate IP-level metadata leakage, deploy the relay as a Tor Hidden Service.

1. Install Tor on the server: `sudo apt install tor`
2. Edit `/etc/tor/torrc` to include:
   ```
   HiddenServiceDir /var/lib/tor/veil_hidden_service/
   HiddenServicePort 80 127.0.0.1:8080
   ```
3. Restart Tor: `sudo systemctl restart tor`
4. Retrieve the `.onion` address:
   ```bash
   sudo cat /var/lib/tor/veil_hidden_service/hostname
   ```
5. Modify the VEIL client to connect to the `.onion` address (requires users to access the client via Tor Browser).
