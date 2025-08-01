#!/bin/bash

# This script runs after the container is created.

# Set ownership of the workspace to the vscode user
sudo chown -R vscode:vscode /workspaces/cockpit-smb-zfs

# Copy the mock smb-zfs script into the container's PATH
sudo cp /workspaces/cockpit-smb-zfs/.devcontainer/mock-smb-zfs.py /usr/local/bin/smb-zfs
sudo chmod +x /usr/local/bin/smb-zfs

# Install npm dependencies for the plugin
echo "--- Installing npm dependencies ---"
npm install

# Configure Cockpit to allow password-less login for the 'vscode' user
# and to be accessible over an unencrypted connection inside the container.
echo "--- Configuring Cockpit ---"
sudo /bin/sh -c 'echo -e "[local]\nuser = vscode\n\n[WebService]\nAllowUnencrypted = true" > /etc/cockpit/cockpit.conf'
sudo systemctl enable --now cockpit.socket

echo "----------------------------------------------------------------"
echo "Dev Container Ready!"
echo ""
echo "Run 'npm run watch' in the VS Code terminal to start the build."
echo "Access Cockpit at: http://localhost:9090"
echo "Login as user 'vscode' (password can be anything)."
echo "----------------------------------------------------------------"

