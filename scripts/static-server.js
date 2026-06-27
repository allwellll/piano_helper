const http = require("http");
const fs = require("fs");
const path = require("path");

const root = process.argv[2];
const port = Number(process.argv[3] || 8124);

if (!root) {
  console.error("Missing root directory");
  process.exit(1);
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const server = http.createServer((request, response) => {
  const rawPath = (request.url || "/").split("?")[0];
  const requestPath = rawPath === "/" ? "/index.html" : rawPath;
  const filePath = path.join(root, decodeURIComponent(requestPath));

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream"
    });
    response.end(data);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Static server running at http://0.0.0.0:${port}`);
});
