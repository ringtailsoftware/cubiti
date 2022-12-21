FROM node:16
ENV LANG C.UTF-8
ENV LC_ALL C.UTF-8
#RUN apk add --no-cache curl-dev build-base
#RUN make

# use changes to package.json to force Docker not to use the cache
# when we change our application's nodejs dependencies:
RUN mkdir -p /build
COPY package.json /tmp/package.json
RUN cd /tmp && npm install
RUN cp -a /tmp/node_modules /build

COPY . /build
WORKDIR /build

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/bin/sh", "/usr/local/bin/entrypoint.sh"]
EXPOSE 8001
CMD /bin/sh
