FROM pgvector/pgvector:pg15

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        ca-certificates \
        build-essential \
        curl \
        bzip2 \
        postgresql-server-dev-15 \
        libicu-dev \
    && rm -rf /var/lib/apt/lists/*

RUN curl -L https://www.xunsearch.com/scws/down/scws-1.2.3.tar.bz2 \
        | tar -xjf - -C /tmp \
    && cd /tmp/scws-1.2.3 \
    && ./configure \
    && make \
    && make install \
    && rm -rf /tmp/scws-1.2.3

RUN git clone --depth=1 https://github.com/amutu/zhparser.git /tmp/zhparser \
    && cd /tmp/zhparser \
    && make \
    && make install \
    && rm -rf /tmp/zhparser
