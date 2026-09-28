# Project VEIL — Design & UI/UX System (DESIGN.md)

**Design System:** Dual-Mode Cryptographic Experience  
**Core Aesthetic:** Consumer Fluidity (*Veil Flow*) meets Tactical Cyberpunk HUD (*Veil Bunker*)  

---

## 1. Dual-Mode Design Philosophy

Project VEIL resolves the fundamental tension in secure software design: **high-security applications usually look intimidating and austere, while friendly consumer applications compromise on cryptographic rigor.**

VEIL decouples the cryptographic engine from the visual representation, offering two first-class interfaces powered by the same post-quantum core:

```
                  ┌───────────────────────────────┐
                  │    Core Cryptographic Engine  │
                  │   (ML-KEM-768 + Double Ratchet│
                  └───────────────┬───────────────┘
                                  │
                  ┌───────────────┴───────────────┐
                  ▼                               ▼
      ┌─────────────────────────┐   ┌──────────────────────────┐
      │        VEIL FLOW        │   │       VEIL BUNKER        │
      │  Consumer / Productivity│   │  Tactical / Zero-Trust   │
      │  WhatsApp-Style Emerald │   │  Stark Cyberpunk HUD     │
      │  Fluid, Soft, Organic   │   │  Hard-edged, Neon Glow   │
      └─────────────────────────┘   └──────────────────────────┘
```

---

## 2. Color Tokens & Visual Themes

### 2.1 Veil Flow (Everyday Secure Messenger)
*Inspired by the highest standards of modern encrypted messengers (WhatsApp/Signal dark mode).*

| Token Name | Hex Code | Purpose |
| :--- | :--- | :--- |
| `flow-bg-app` | `#0b141a` | Main application viewport background |
| `flow-bg-sidebar`| `#111b21` | Sidebar, contact list, and modal interiors |
| `flow-bg-header` | `#202c33` | Top navigation bars and input dock container |
| `flow-bg-bubble-me` | `#005c4b` | Sent message bubble background |
| `flow-bg-bubble-peer`| `#202c33` | Received message bubble background |
| `flow-accent-primary` | `#00a884` | Emerald branding, active tabs, action buttons |
| `flow-accent-read` | `#53bdeb` | Double-check read receipts and `@mentions` |
| `flow-border-subtle` | `#222e35` | Card dividers and modal outlines |
| `flow-text-primary` | `#e9edef` | High-contrast readable body text |
| `flow-text-muted` | `#8696a0` | Timestamps, channel subtitles, statuses |

### 2.2 Veil Bunker (Tactical Cyberpunk HUD)
*Inspired by Stark Industries telemetry, military avionics, and cyberpunk tactical terminals.*

| Token Name | Hex Code | Purpose |
| :--- | :--- | :--- |
| `bunker-bg-deep` | `#04080e` | Deep obsidian backdrop |
| `bunker-bg-surface` | `#0b121e` | Semitransparent glass cards and panels |
| `bunker-cyan-glow` | `#00f0ff` | Primary laser cyan accent (`shadow-glow-cyan`) |
| `bunker-gold-warning`| `#ffd700` | Unverified peers, key desync, vanish timers |
| `bunker-crimson-alert`| `#ff2a5f` | Offline state, panic wipe triggers, errors |
| `bunker-border-grid` | `rgba(0, 240, 255, 0.2)` | Polygonal borders and telemetry grids |

---

## 3. Typography Hierarchy

The system loads three specialized font families tailored to their respective roles:

```css
/* 1. Body & Flow Text: High-legibility modern sans-serif */
font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;

/* 2. Tactical HUD, Buttons & Headers: High-tech condensed uppercase */
font-family: 'Rajdhani', sans-serif;

/* 3. Hashes, Sequence Numbers, Timers & Ciphertext: Precision monospace */
font-family: 'JetBrains Mono', monospace;
```

### Type Scale
- **Display HUD (Header Titles):** `Rajdhani`, 18px / 20px, Bold, `letter-spacing: 0.15em`, Uppercase.
- **Section Headers:** `Rajdhani`, 11px, Semi-Bold, `letter-spacing: 0.2em`, Uppercase.
- **Message Body Text:** `Inter`, 14px, Regular, Line-Height: 1.5.
- **Cryptographic Footers & Telemetry:** `JetBrains Mono`, 10px / 11px, Regular.

---

## 4. Component Design Specifications

### 4.1 Message Bubbles
- **Veil Flow:**
  - Sent: `bg-[#005c4b] text-white rounded-2xl rounded-tr-xs ml-auto shadow-sm`.
  - Received: `bg-[#202c33] text-gray-100 rounded-2xl rounded-tl-xs mr-auto shadow-sm`.
  - Hover Action Popover: Quick emojis (`👍 ❤️ 🔥 😂 😮 👏`), reply, star, forward, edit, delete.
- **Veil Bunker:**
  - Sent: Gradient `from-arc-cyan/15 to-arc-cyan/5 border border-arc-cyan/30 ml-auto rounded-tl-xl rounded-bl-xl rounded-br-xl shadow-[inset_0_0_15px_rgba(0,240,255,0.05)]`.
  - Received: `bg-stark-card border-l-2 border-slate-500 mr-auto rounded-tr-xl rounded-br-xl rounded-bl-xl shadow-lg`.

### 4.2 Interactive In-Chat Polls
- Poll cards feature clear question titles, single/multiple choice tags, and interactive option bars.
- Live animated percentage fill bar (`transition-all duration-300`) reflects real-time voting fan-out without page jumps.
- Voted state displays filled emerald/cyan indicator circles.

### 4.3 WebRTC Video & Audio Calling Interface
- **Remote Video:** Full-viewport rendering with `object-cover`.
- **Local Stream (PiP):** Floating thumbnail (`w-28 h-40` or `w-36 h-48`) positioned in the upper right corner with rounded corners and border glow.
- **Floating Control Dock:** Centered pill bar at screen bottom:
  - Microphone Mute (`Mic` / `MicOff`).
  - Camera Toggle (`Video` / `VideoOff`).
  - Camera Flip (`SwitchCamera` for mobile front/back switching).
  - Call Termination (`PhoneOff` in vibrant red).

### 4.4 Chat Wallpapers
The system provides 6 distinct chat backgrounds customizable per user:
1. **WhatsApp Classic Doodle:** Subtle vector icons patterned over dark green-slate.
2. **Deep Emerald:** Rich, distraction-free solid slate-emerald.
3. **Slate Minimal:** Cool neutral gray-charcoal for maximum readability.
4. **Cyberpunk HUD:** Faint grid overlays and circuit traces.
5. **Pitch Obsidian:** True OLED `#000000` black for battery conservation.
6. **Cosmic Indigo:** Deep cosmic violet-indigo gradient.

---

## 5. Touch & Mobile Ergonomics

- **Swipe-to-Reply:** Every message row can be swiped horizontally to the right. Damped resistance prevents accidental triggers, displaying an animated reply arrow and vibrating the device when threshold is crossed.
- **Audio Recording Dock:** Holding the mic triggers an in-line recording mode with live audio waveform bars, recording duration timer, and a one-click trash discard button.
- **Mobile Action Sheets:** Modals on mobile slide in from the bottom with full thumb accessibility.
