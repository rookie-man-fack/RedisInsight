# this dockerfile has two stages, a build stage and the executable stage.
# the build stage is responsible for building the frontend, the backend,
# and the frontend's static assets. ideally, we could build the frontend and backend
# independently and in parallel in different stages, but there is a dependency
# on the backend to build those assets. until we fix that, this approach is
# the best way to minimize the number of node_module restores and build steps
# while still keeping the final image small.

FROM node:18.15.0-alpine as build

# build time args and environment variables
ARG SERVER_TLS_CERT
ARG SERVER_TLS_KEY
ARG SEGMENT_WRITE_KEY
ENV SERVER_TLS_CERT=${SERVER_TLS_CERT}
ENV SERVER_TLS_KEY=${SERVER_TLS_KEY}
ENV SEGMENT_WRITE_KEY=${SEGMENT_WRITE_KEY}

# update apk repository and install build dependencies
RUN apk update && apk add --no-cache --virtual .gyp \
        python3 \
        make \
        g++

# set workdir
WORKDIR /usr/src/app

# restore node_modules for front-end
COPY package.json yarn.lock babel.config.cjs tsconfig.json ./
RUN SKIP_POSTINSTALL=1 yarn install

# prepare backend by copying scripts/configs and installing node modules
# this is required to build the static assets
COPY configs ./configs
COPY scripts ./scripts
COPY redisinsight ./redisinsight
RUN yarn --cwd redisinsight/api install

# build the frontend, static assets, and backend api
RUN yarn build:web
RUN yarn build:statics
RUN yarn build:api

# install backend _again_ to build native modules and remove dev dependencies,
# then run autoclean to remove additional unnecessary files
RUN yarn --cwd ./redisinsight/api install --production
COPY ./redisinsight/api/.yarnclean.prod ./redisinsight/api/.yarnclean
RUN yarn --cwd ./redisinsight/api autoclean --force

FROM node:18.15.0-alpine

# runtime args and environment variables
ARG NODE_ENV=production
ARG SERVER_TLS_CERT
ARG SERVER_TLS_KEY
ARG SEGMENT_WRITE_KEY
ENV SERVER_TLS_CERT=${SERVER_TLS_CERT}
ENV SERVER_TLS_KEY=${SERVER_TLS_KEY}
ENV SEGMENT_WRITE_KEY=${SEGMENT_WRITE_KEY}
ENV NODE_ENV=${NODE_ENV}
ENV SERVER_STATIC_CONTENT=true
ENV BUILD_TYPE='DOCKER_ON_PREMISE'
ENV APP_FOLDER_ABSOLUTE_PATH='/data'

# set workdir
WORKDIR /usr/src/app

# copy artifacts built in previous stage to this one
COPY --from=build --chown=node:node /usr/src/app/redisinsight/api/dist ./redisinsight/api/dist
COPY --from=build --chown=node:node /usr/src/app/redisinsight/api/node_modules ./redisinsight/api/node_modules
COPY --from=build --chown=node:node /usr/src/app/redisinsight/ui/dist ./redisinsight/ui/dist

# folder to store local database, plugins, logs and all other files
RUN mkdir -p /data && chown -R node:node /data

# copy the docker entry point script and make it executable
COPY --chown=node:node ./docker-entry.sh ./
RUN chmod +x docker-entry.sh

# since RI is hard-code to port 5000, expose it from the container
EXPOSE 5000

# don't run the node process as root
USER node

# serve the application 🚀
ENTRYPOINT ["./docker-entry.sh", "node", "redisinsight/api/dist/src/main"]
