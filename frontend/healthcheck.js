const http = require("http");

const port = process.env.PORT || 3000;

http
  .get(`http://localhost:${port}/`, (res) => {
    process.exit(res.statusCode < 500 ? 0 : 1);
  })
  .on("error", () => process.exit(1));
