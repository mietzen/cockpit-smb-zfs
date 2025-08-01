# Use the official Fedora image as a base, as Cockpit is developed on it.
FROM fedora:latest

# Install system dependencies required for Cockpit development,
# the plugin's build process, and running the mock environment.
RUN dnf update -y && dnf install -y \
    cockpit cockpit-bridge \
    nodejs npm \
    python3 python3-pip \
    make gcc sudo \
    && dnf clean all

# Create a non-root user 'vscode' for security and to match VS Code's default.
# Grant passwordless sudo permissions to this user for convenience inside the container.
RUN useradd -m vscode && \
    usermod -aG wheel vscode && \
    echo "vscode ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers

# Switch to the non-root user
USER vscode

# Set the working directory within the container
WORKDIR /workspaces/cockpit-smb-zfs

# Default command to run when the container starts
CMD ["/bin/bash"]
