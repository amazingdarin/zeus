FROM pgvector/pgvector:pg15

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        build-essential \
        postgresql-server-dev-15 \
        libicu-dev \
        libscws-dev \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth=1 https://github.com/amutu/zhparser.git /tmp/zhparser \
    && cd /tmp/zhparser \
    && make \
    && make install \
    && rm -rf /tmp/zhparser
