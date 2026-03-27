const express = require('express');
const app = express();
app.use(express.json());

let tasks = [
    { id: 1, title: 'Setup Project', completed: true },
    { id: 2, title: 'Run Tests', completed: false }
];

// 1. Health Check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'UP', timestamp: new Date() });
});

// 2. Get All Tasks
app.get('/api/tasks', (req, res) => {
    res.json(tasks);
});

// 3. Get Single Task
app.get('/api/tasks/:id', (req, res) => {
    const task = tasks.find(t => t.id === parseInt(req.params.id));
    if (!task) return res.status(404).json({ message: 'Task not found' });
    res.json(task);
});

// 4. Create Task
app.post('/api/tasks', (req, res) => {
    if (!req.body.title) {
        return res.status(400).json({ message: 'Title is required' });
    }
    const newTask = {
        id: tasks.length + 1,
        title: req.body.title,
        completed: false
    };
    tasks.push(newTask);
    res.status(201).json(newTask);
});

// 5. Delete Task
app.delete('/api/tasks/:id', (req, res) => {
    const index = tasks.findIndex(t => t.id === parseInt(req.params.id));
    if (index === -1) return res.status(404).json({ message: 'Task not found' });
    tasks.splice(index, 1);
    res.status(204).send();
});

module.exports = app;