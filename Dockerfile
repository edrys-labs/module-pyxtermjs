FROM ubuntu:22.04

# Install system dependencies
RUN apt-get update --fix-missing && \
    apt-get install -y \
    apt-utils \
    python3 \
    python3-pip \
    vim \
    htop \
    zsh && \
    rm -rf /var/lib/apt/lists/*

WORKDIR "/var/www"
COPY requirements.txt .
RUN pip3 install -r requirements.txt

# Setup appuser and appgroup before copying files
ARG user=appuser
ARG group=appuser
ARG uid=1000
ARG gid=1000
RUN groupadd -g ${gid} ${group} && \
    useradd -u ${uid} -g ${group} -s /bin/sh -m ${user}

# Copy zsh configuration
COPY _assets/.zshrc /home/appuser/.zshrc
COPY _assets/oh-my-zsh /home/appuser/.oh-my-zsh

# Copy application files
COPY . .

# Switch to user we must not set group to make the configuration done above apply
# !! if ${user} is not setup correctly the next line might result in group being root !!
USER ${user}

EXPOSE 5000

ENTRYPOINT python3 -m pyxtermjs --cors True --host 0.0.0.0 --command zsh
