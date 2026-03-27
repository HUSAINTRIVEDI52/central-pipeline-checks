const app = require("./app");
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Test Server running on http://localhost:${PORT}`);
});
