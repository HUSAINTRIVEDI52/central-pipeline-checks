const request = require("supertest");
const app = require("../src/app");

describe("Task API Integration Tests", () => {
  // Health Check
  test("1. Smoke Test: GET /health should return 200", async () => {
    const res = await request(app).get("/health");
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("UP");
  });

  // GET All
  test("2. GET /api/tasks should return all tasks", async () => {
    const res = await request(app).get("/api/tasks");
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  // GET Single
  test("3. GET /api/tasks/:id should return a specific task", async () => {
    const res = await request(app).get("/api/tasks/1");
    expect(res.statusCode).toBe(200);
    expect(res.body.title).toBe("Setup Project");
  });

  test("4. GET /api/tasks/:id with invalid ID should return 404", async () => {
    const res = await request(app).get("/api/tasks/999");
    expect(res.statusCode).toBe(404);
  });

  // POST
  test("5. POST /api/tasks should create a new task", async () => {
    const newTask = { title: "New Unit Test" };
    const res = await request(app).post("/api/tasks").send(newTask);
    expect(res.statusCode).toBe(201);
    expect(res.body.title).toBe("New Unit Test");
  });

  test("6. POST /api/tasks without title should return 400", async () => {
    const res = await request(app).post("/api/tasks").send({});
    expect(res.statusCode).toBe(400);
  });

  // DELETE
  test("7. DELETE /api/tasks/:id should remove a task", async () => {
    const res = await request(app).delete("/api/tasks/2");
    expect(res.statusCode).toBe(204);
  });

  test("8. DELETE /api/tasks/:id with non-existing ID should return 404", async () => {
    const res = await request(app).delete("/api/tasks/500");
    expect(res.statusCode).toBe(404);
  });

  // Data Integrity
  test("9. Verify task list length after additions", async () => {
    const res = await request(app).get("/api/tasks");
    // Based on previous tests, we added 1 and deleted 1, should be original count
    expect(res.body.length).toBe(2);
  });

  test("10. Ensure JSON Content-Type header is present", async () => {
    const res = await request(app).get("/api/tasks");
    expect(res.headers["content-type"]).toMatch(/json/);
  });
});
