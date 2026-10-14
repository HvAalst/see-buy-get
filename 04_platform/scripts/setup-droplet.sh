#!/usr/bin/env bash
#
# Makes a new DigitalOcean Droplet (Ubuntu) ready to be deployed to. Run ONCE, as root, from your own machine:
#
#   scp 04_platform/scripts/setup-droplet.sh root@<the droplet's address>:
#   ssh root@<the droplet's address> "bash setup-droplet.sh '<the PUBLIC half of the deploy key>'"
#
# It installs Docker, makes the `deploy` user the workflow signs in as, opens the firewall for the web and for SSH
# and nothing else, and makes /opt/seebuyget. It is safe to run again. It puts no secret on the server: those are
# made by the first release (scripts/deploy.sh), in /opt/seebuyget/.env.

set -euo pipefail

die() { printf '\n%s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run this as root"
KEY="${1:-}"
[[ "$KEY" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp[0-9]+)\ [A-Za-z0-9+/=]+ ]] ||
  die "give the PUBLIC half of the deploy key, in quotes — the one line of the .pub file, starting ssh-ed25519"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl openssl ufw >/dev/null

# Docker, from Docker's own repository (the one in Ubuntu's is older and has no compose plugin).
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null
docker compose version >/dev/null || die "Docker is installed without its compose plugin"

# Who the deploy workflow signs in as. No password: the key is the only way in. Being in the docker group is as
# good as being root on this machine, so the private half of this key is worth what the server is.
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy >/dev/null
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
grep -qxF "$KEY" /home/deploy/.ssh/authorized_keys || echo "$KEY" >> /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

install -d -m 750 -o deploy -g deploy /opt/seebuyget
install -d -m 700 -o deploy -g deploy /opt/seebuyget/backups

# The web (80 to be sent on to 443, 443 itself, and 443/udp for HTTP/3) and SSH. The API's own port is never
# published: it is reached through the web server only. (Docker publishes ports past ufw, which is why it matters
# that docker-compose.yml publishes these three and no other.)
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null

ADDRESS="$(curl -fsS --max-time 3 http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address 2>/dev/null || hostname -I | awk '{print $1}')"
cat <<EOF

This server is ready. In the repository on GitHub (Settings → Secrets and variables → Actions):

  variable  DEPLOY_HOST          $ADDRESS
  variable  DEPLOY_KNOWN_HOSTS   $ADDRESS $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)
  secret    DEPLOY_SSH_KEY       the PRIVATE half of the deploy key (the whole file)

DEPLOY_KNOWN_HOSTS is how the workflow knows it is talking to this server and not to one standing in its place:
copy that line as it is. If DEPLOY_HOST is to be a name instead of the number, put the name at the start of both.
EOF
