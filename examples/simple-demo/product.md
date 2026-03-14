# Product: TaskBoard Lite

## Vision
TaskBoard Lite is a small single-user web app for organising personal tasks
visually and locally — no backend, no login required.

## Product Goals
- Allow a user to create and manage personal tasks
- Provide a clear visual workflow with task states
- Persist everything locally in the browser
- Stay small, fast, and easy to use

## Users

### Primary User
Single person managing personal or study tasks.

## In Scope

### Feature 1 - Task CRUD
The user can:
- Create a task with title and description
- Edit the title and description of a task
- Delete a task
- View the list of all tasks

### Feature 2 - Workflow States
Each task has a state:
- Todo
- Doing
- Done

The user can change state quickly.

### Feature 3 - Filters and Search
The user can:
- Filter tasks by state
- Search tasks by text in the title

### Feature 4 - Local Persistence
Tasks must remain available after a browser refresh.

### Feature 5 - Minimal Dashboard
The user sees:
- Total number of tasks
- Number of tasks in Todo
- Number of tasks in Doing
- Number of tasks in Done

## Out of Scope
- Login
- Multi-user
- Real-time collaboration
- Remote backend
- Email notifications
- File attachments

## Non-Functional Requirements
- Fast local startup
- Simple and responsive UI
- No data uploaded to external servers
- Errors handled with clear messages
- Testable and maintainable code

## Suggested Technical Constraints
- Web frontend
- TypeScript
- Local browser persistence (localStorage)
- Keep it simple, avoid over-engineering

## Acceptance Criteria
- I can create, edit, and delete tasks
- I can change the state of a task
- I can filter and search tasks
- After a refresh, tasks remain saved
- I see consistent counters per state
- Automated tests pass

## Delivery Preference
Implement in phases:
1. Task CRUD (basic)
2. Workflow states
3. Local persistence
4. Filters and search
5. Minimal dashboard
