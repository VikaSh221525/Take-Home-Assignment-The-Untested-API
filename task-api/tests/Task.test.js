const request = require('supertest');
const app = require('../src/app');
const taskService = require('../src/services/taskService');

beforeEach(() => {
    taskService._reset();
});

//Helper 
const createTask = (overrides = {}) =>
    taskService.create({ title: 'Test Task', priority: 'high', ...overrides });

// UNIT TESTS — taskService.js

describe('taskService — getAll', () => {
    it('returns empty array when no tasks exist', () => {
        expect(taskService.getAll()).toEqual([]);
    });

    it('returns all created tasks', () => {
        createTask({ title: 'A' });
        createTask({ title: 'B' });
        expect(taskService.getAll()).toHaveLength(2);
    });

    it('returns a copy, not the internal reference', () => {
        const result = taskService.getAll();
        result.push({ fake: true });
        expect(taskService.getAll()).toHaveLength(0);
    });
});

describe('taskService — create', () => {
    it('creates a task with required fields and defaults', () => {
        const task = createTask();
        expect(task).toMatchObject({
            title: 'Test Task',
            description: '',
            status: 'todo',
            priority: 'high',
            dueDate: null,
            completedAt: null,
        });
        expect(task.id).toBeDefined();
        expect(task.createdAt).toBeDefined();
    });

    it('stores the task in the list', () => {
        createTask();
        expect(taskService.getAll()).toHaveLength(1);
    });
});

describe('taskService — findById', () => {
    it('returns the task when found', () => {
        const task = createTask();
        expect(taskService.findById(task.id)).toEqual(task);
    });

    it('returns undefined for unknown id', () => {
        expect(taskService.findById('nonexistent')).toBeUndefined();
    });
});

describe('taskService — getByStatus', () => {
    it('returns only tasks with matching status', () => {
        createTask({ status: 'todo' });
        createTask({ status: 'todo' });
        createTask({ status: 'done' });
        const result = taskService.getByStatus('todo');
        expect(result).toHaveLength(2);
        result.forEach((t) => expect(t.status).toBe('todo'));
    });

    it('returns empty array when no tasks match', () => {
        createTask({ status: 'todo' });
        expect(taskService.getByStatus('done')).toHaveLength(0);
    });

    // BUG: getByStatus uses .includes() — 'todo' would match 'todo' AND any
    // future status containing the substring. Using === is correct.
    it('does exact status matching, not substring matching', () => {
        createTask({ status: 'todo' });
        // 'in_progress' contains 'in' — substring match would be wrong
        const result = taskService.getByStatus('in');
        expect(result).toHaveLength(0);
    });
});

describe('taskService — getPaginated', () => {
    beforeEach(() => {
        for (let i = 1; i <= 15; i++) createTask({ title: `Task ${i}` });
    });

    // BUG: getPaginated uses `page * limit` instead of `(page - 1) * limit`
    // Page 1 should return items 1–10, but the bug causes it to skip them entirely.
    it('page 1 returns the first set of results', () => {
        const result = taskService.getPaginated(1, 10);
        expect(result).toHaveLength(10);
        expect(result[0].title).toBe('Task 1');
    });

    it('page 2 returns the next set of results', () => {
        const result = taskService.getPaginated(2, 10);
        expect(result).toHaveLength(5);
        expect(result[0].title).toBe('Task 11');
    });

    it('returns empty array beyond available pages', () => {
        const result = taskService.getPaginated(99, 10);
        expect(result).toHaveLength(0);
    });
});

describe('taskService — update', () => {
    it('updates allowed fields and returns updated task', () => {
        const task = createTask();
        const updated = taskService.update(task.id, { title: 'Updated', priority: 'low' });
        expect(updated.title).toBe('Updated');
        expect(updated.priority).toBe('low');
    });

    it('returns null for unknown id', () => {
        expect(taskService.update('bad-id', { title: 'X' })).toBeNull();
    });

    it('preserves fields not included in the update', () => {
        const task = createTask({ description: 'Keep me' });
        taskService.update(task.id, { title: 'New Title' });
        const found = taskService.findById(task.id);
        expect(found.description).toBe('Keep me');
    });
});

describe('taskService — remove', () => {
    it('removes an existing task and returns true', () => {
        const task = createTask();
        expect(taskService.remove(task.id)).toBe(true);
        expect(taskService.findById(task.id)).toBeUndefined();
    });

    it('returns false for unknown id', () => {
        expect(taskService.remove('nope')).toBe(false);
    });
});

describe('taskService — completeTask', () => {
    it('sets status to done and records completedAt', () => {
        const task = createTask();
        const result = taskService.completeTask(task.id);
        expect(result.status).toBe('done');
        expect(result.completedAt).not.toBeNull();
    });

    // BUG: completeTask hard-codes priority: 'medium', overwriting the original.
    it('preserves the original priority when completing a task', () => {
        const task = createTask({ priority: 'high' });
        const result = taskService.completeTask(task.id);
        expect(result.priority).toBe('high');
    });

    it('returns null for unknown id', () => {
        expect(taskService.completeTask('bad-id')).toBeNull();
    });
});

describe('taskService — getStats', () => {
    it('returns zero counts when no tasks exist', () => {
        expect(taskService.getStats()).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
    });

    it('counts tasks by status correctly', () => {
        createTask({ status: 'todo' });
        createTask({ status: 'todo' });
        createTask({ status: 'in_progress' });
        createTask({ status: 'done' });
        const stats = taskService.getStats();
        expect(stats.todo).toBe(2);
        expect(stats.in_progress).toBe(1);
        expect(stats.done).toBe(1);
    });

    it('counts overdue tasks (non-done with past dueDate)', () => {
        createTask({ dueDate: '2000-01-01T00:00:00.000Z', status: 'todo' });
        createTask({ dueDate: '2000-01-01T00:00:00.000Z', status: 'done' }); // done — not overdue
        const stats = taskService.getStats();
        expect(stats.overdue).toBe(1);
    });

    it('does not count future due dates as overdue', () => {
        createTask({ dueDate: '2999-01-01T00:00:00.000Z', status: 'todo' });
        expect(taskService.getStats().overdue).toBe(0);
    });
});

// INTEGRATION TESTS — API routes via Supertest

describe('GET /tasks', () => {
    it('returns 200 and empty array initially', async () => {
        const res = await request(app).get('/tasks');
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    it('returns all tasks', async () => {
        createTask({ title: 'A' });
        createTask({ title: 'B' });
        const res = await request(app).get('/tasks');
        expect(res.body).toHaveLength(2);
    });

    it('filters by status', async () => {
        createTask({ status: 'todo' });
        createTask({ status: 'done' });
        const res = await request(app).get('/tasks?status=todo');
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].status).toBe('todo');
    });

    it('returns paginated results for page 1', async () => {
        for (let i = 0; i < 15; i++) createTask({ title: `Task ${i}` });
        const res = await request(app).get('/tasks?page=1&limit=10');
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(10);
    });

    it('returns empty array for a page beyond available data', async () => {
        createTask();
        const res = await request(app).get('/tasks?page=99&limit=10');
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(0);
    });
});

describe('GET /tasks/stats', () => {
    it('returns correct structure', async () => {
        const res = await request(app).get('/tasks/stats');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('todo');
        expect(res.body).toHaveProperty('in_progress');
        expect(res.body).toHaveProperty('done');
        expect(res.body).toHaveProperty('overdue');
    });

    it('reflects created tasks accurately', async () => {
        createTask({ status: 'todo' });
        createTask({ status: 'done' });
        const res = await request(app).get('/tasks/stats');
        expect(res.body.todo).toBe(1);
        expect(res.body.done).toBe(1);
    });
});

describe('POST /tasks', () => {
    it('creates a task and returns 201', async () => {
        const res = await request(app)
        .post('/tasks')
        .send({ title: 'New Task', priority: 'high' });
        expect(res.status).toBe(201);
        expect(res.body.title).toBe('New Task');
        expect(res.body.id).toBeDefined();
    });

    it('returns 400 when title is missing', async () => {
        const res = await request(app).post('/tasks').send({ priority: 'high' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/title/i);
    });

    it('returns 400 when title is an empty string', async () => {
        const res = await request(app).post('/tasks').send({ title: '   ' });
        expect(res.status).toBe(400);
    });

    it('returns 400 for invalid status', async () => {
        const res = await request(app).post('/tasks').send({ title: 'X', status: 'invalid' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/status/i);
    });

    it('returns 400 for invalid priority', async () => {
        const res = await request(app).post('/tasks').send({ title: 'X', priority: 'urgent' });
        expect(res.status).toBe(400);
    });

    it('returns 400 for an invalid dueDate', async () => {
        const res = await request(app).post('/tasks').send({ title: 'X', dueDate: 'not-a-date' });
        expect(res.status).toBe(400);
    });

    it('uses defaults when optional fields are omitted', async () => {
        const res = await request(app).post('/tasks').send({ title: 'Minimal' });
        expect(res.status).toBe(201);
        expect(res.body.status).toBe('todo');
        expect(res.body.priority).toBe('medium');
        expect(res.body.description).toBe('');
    });
});

describe('PUT /tasks/:id', () => {
    it('updates a task and returns the updated version', async () => {
        const task = createTask();
        const res = await request(app)
        .put(`/tasks/${task.id}`)
        .send({ title: 'Updated Title' });
        expect(res.status).toBe(200);
        expect(res.body.title).toBe('Updated Title');
    });

    it('returns 404 for unknown id', async () => {
        const res = await request(app).put('/tasks/nonexistent').send({ title: 'X' });
        expect(res.status).toBe(404);
    });

    it('returns 400 when title is empty string', async () => {
        const task = createTask();
        const res = await request(app).put(`/tasks/${task.id}`).send({ title: '' });
        expect(res.status).toBe(400);
    });

    it('returns 400 for invalid status value', async () => {
        const task = createTask();
        const res = await request(app).put(`/tasks/${task.id}`).send({ status: 'archived' });
        expect(res.status).toBe(400);
    });
});

describe('DELETE /tasks/:id', () => {
    it('deletes a task and returns 204', async () => {
        const task = createTask();
        const res = await request(app).delete(`/tasks/${task.id}`);
        expect(res.status).toBe(204);
        expect(taskService.findById(task.id)).toBeUndefined();
    });

    it('returns 404 for unknown id', async () => {
        const res = await request(app).delete('/tasks/unknown-id');
        expect(res.status).toBe(404);
    });
});

describe('PATCH /tasks/:id/complete', () => {
    it('marks task as done and sets completedAt', async () => {
        const task = createTask();
        const res = await request(app).patch(`/tasks/${task.id}/complete`);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('done');
        expect(res.body.completedAt).not.toBeNull();
    });

    it('returns 404 for unknown id', async () => {
        const res = await request(app).patch('/tasks/bad-id/complete');
        expect(res.status).toBe(404);
    });

    // BUG: completeTask resets priority to 'medium' — confirmed via API
    it('does not change the task priority when completing', async () => {
        const task = createTask({ priority: 'high' });
        const res = await request(app).patch(`/tasks/${task.id}/complete`);
        expect(res.body.priority).toBe('high');
    });
});

// NEW FEATURE — PATCH /tasks/:id/assign

describe('PATCH /tasks/:id/assign', () => {
    it('assigns a task to a user and returns the updated task', async () => {
        const task = createTask();
        const res = await request(app)
        .patch(`/tasks/${task.id}/assign`)
        .send({ assignee: 'Alice' });
        expect(res.status).toBe(200);
        expect(res.body.assignee).toBe('Alice');
    });

    it('returns 404 when task does not exist', async () => {
        const res = await request(app)
        .patch('/tasks/nonexistent/assign')
        .send({ assignee: 'Alice' });
        expect(res.status).toBe(404);
    });

    it('returns 400 when assignee is missing', async () => {
        const task = createTask();
        const res = await request(app).patch(`/tasks/${task.id}/assign`).send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/assignee/i);
    });

    it('returns 400 when assignee is an empty string', async () => {
        const task = createTask();
        const res = await request(app)
        .patch(`/tasks/${task.id}/assign`)
        .send({ assignee: '   ' });
        expect(res.status).toBe(400);
    });

    it('allows reassigning a task to a different person', async () => {
        const task = createTask();
        await request(app).patch(`/tasks/${task.id}/assign`).send({ assignee: 'Alice' });
        const res = await request(app)
        .patch(`/tasks/${task.id}/assign`)
        .send({ assignee: 'Bob' });
        expect(res.status).toBe(200);
        expect(res.body.assignee).toBe('Bob');
    });

    it('preserves other task fields when assigning', async () => {
        const task = createTask({ title: 'Important', priority: 'high' });
        const res = await request(app)
        .patch(`/tasks/${task.id}/assign`)
        .send({ assignee: 'Alice' });
        expect(res.body.title).toBe('Important');
        expect(res.body.priority).toBe('high');
    });
});