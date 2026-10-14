---
name: menu
description: Show the menu of this project's commands (/start, /stop, /restart, /menu) in plain, non-technical language. Use when the user types /menu, or asks what commands there are, what they can do here, or for help getting started.
allowed-tools: Bash(ls .claude/skills)
---

Show the user the menu below. They may not be technical, so keep the wording plain: no jargon, no file paths, no
code beyond the commands themselves.

Before showing it, run `ls .claude/skills` and compare the folders with the commands listed here. If a folder has no
entry yet, read its `SKILL.md` and add a line for it in the same plain style. Then show the menu as written, and
add nothing after it.

---

## 📋 SeeBuyGet — what you can ask me

Type a command, or just say what you want in your own words ("start the app", "turn it off").

### ▶️ `/start` — Turn the app on

Starts SeeBuyGet on this computer so you can open it in your web browser. When it's ready, I'll give you the links
to click.

- `/start`: the driver app, ready in a minute or two.
- `/start driver tower`: name the apps you want. You can name any of these: **home** (the front page), **driver**,
  **agent** (a pick-up shop), **send** (sending a parcel), **fleet**, **mdp** (the sorting hub), **vendor**
  (a merchant), **business**, **tower** (the operator console). Or say **all**.
- `/start seed`: also fills the app with sample people, shops and parcels, and gives you a sheet of logins to try.
- `/start docker`: runs it the way the live website runs. It's slower to start, but closer to the real thing.

### ⏹️ `/stop` — Turn the app off

Stops everything that's running. Your saved information is kept; nothing is deleted.

### 🔄 `/restart` — Turn it off and on again

Use it when something looks stuck, or after a change that doesn't show up. It brings back the same apps you had open.

- `/restart docker rebuild`: also rebuilds the app from the latest changes, if you're running it the "live website"
  way.

### 📋 `/menu` — Show this list again

---

**Good to know**

- **Is it running?** Just ask me "is the app running?".
- **On the live website** (the server), I'll always ask you before I stop or restart anything, because everyone
  using the site would be affected.
- **Your data is safe.** None of these commands delete accounts, balances or parcels.
