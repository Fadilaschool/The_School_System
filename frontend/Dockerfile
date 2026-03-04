FROM nginx:1.25-alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy all frontend static files
COPY . /usr/share/nginx/html

# Remove any sensitive files copied by accident
RUN rm -f /usr/share/nginx/html/.env \
    /usr/share/nginx/html/nginx.conf \
    /usr/share/nginx/html/Dockerfile

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
