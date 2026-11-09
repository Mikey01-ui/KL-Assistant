import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useHudDismiss } from '../hooks/useHudDismiss';

function formatDue(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();

  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Today · ${timeStr}`;
  if (isTomorrow) return `Tomorrow · ${timeStr}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ` · ${timeStr}`;
}

export default function TasksWidget() {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [activeTab, setActiveTab] = useState('tasks'); // 'tasks' | 'notes'
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState([]);
  const [newTitle, setNewTitle] = useState('');
  const [filter, setFilter] = useState('all'); // 'all', 'pending', 'completed'
  const inputRef = useRef(null);

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      setExiting(false);
    }, 400);
  }, []);

  useHudDismiss('tasks', dismiss);

  const loadTasks = useCallback(async () => {
    try {
      const list = await window.electronAPI?.tasksList?.({ includeCompleted: true, limit: 15 });
      if (Array.isArray(list) && list.length > 0) {
        setItems(list);
      } else {
        setItems([]);
      }
    } catch {
      setItems([]);
    }
  }, []);

  const loadNotes = useCallback(async () => {
    try {
      const list = await window.electronAPI?.notesList?.({ limit: 15 });
      if (Array.isArray(list)) {
        setNotes(list);
      } else {
        setNotes([]);
      }
    } catch {
      setNotes([]);
    }
  }, []);

  useEffect(() => {
    const onTasks = async (e) => {
      setExiting(false);
      setVisible(true);
      if (e.detail?.tasks && Array.isArray(e.detail.tasks) && e.detail.tasks.length > 0) {
        setItems(e.detail.tasks);
      } else {
        await loadTasks();
      }
      setActiveTab('tasks');
    };

    const onTasksRefresh = async () => {
      setExiting(false);
      setVisible(true);
      await loadTasks();
      setActiveTab('tasks');
    };

    const onNotesRefresh = async () => {
      setExiting(false);
      setVisible(true);
      await loadNotes();
      setActiveTab('notes');
    };

    window.addEventListener('jarvis:tasks', onTasks);
    window.addEventListener('jarvis:tasks-refresh', onTasksRefresh);
    window.addEventListener('jarvis:notes-refresh', onNotesRefresh);

    return () => {
      window.removeEventListener('jarvis:tasks', onTasks);
      window.removeEventListener('jarvis:tasks-refresh', onTasksRefresh);
      window.removeEventListener('jarvis:notes-refresh', onNotesRefresh);
    };
  }, [loadTasks, loadNotes]);

  // Load notes whenever switching to notes tab
  useEffect(() => {
    if (activeTab === 'notes') {
      loadNotes();
    } else {
      loadTasks();
    }
  }, [activeTab, loadNotes, loadTasks]);

  // Auto-dismiss after speech ends
  useEffect(() => {
    if (!visible) return undefined;
    let timer = null;
    const onTtsDone = () => {
      timer = setTimeout(() => {
        dismiss();
      }, 7000);
    };
    window.addEventListener('jarvis:tts-finished', onTtsDone);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('jarvis:tts-finished', onTtsDone);
    };
  }, [visible, dismiss]);

  const handleToggle = async (id) => {
    setItems((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );
    try {
      if (window.electronAPI?.tasksToggle) {
        await window.electronAPI.tasksToggle(id);
      } else if (window.electronAPI?.tasksComplete) {
        await window.electronAPI.tasksComplete(id);
      }
    } catch (err) {
      console.warn('Failed to toggle task:', err);
    }
  };

  const handleDeleteTask = async (e, id) => {
    e.stopPropagation();
    setItems((prev) => prev.filter((t) => t.id !== id));
    try {
      await window.electronAPI?.tasksDelete?.(id);
    } catch (err) {
      console.warn('Failed to delete task:', err);
    }
  };

  const handleDeleteNote = async (e, id) => {
    e.stopPropagation();
    setNotes((prev) => prev.filter((n) => n.id !== id));
    try {
      await window.electronAPI?.notesDelete?.(id);
    } catch (err) {
      console.warn('Failed to delete note:', err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const val = newTitle.trim();
    if (!val) return;

    if (activeTab === 'tasks') {
      const tempId = String(Date.now());
      const optimisticTask = { id: tempId, title: val, completed: false, dueAt: Date.now() + 86400000 };
      setItems((prev) => [optimisticTask, ...prev]);
      setNewTitle('');

      try {
        const res = await window.electronAPI?.tasksAdd?.({ title: val, dueAt: optimisticTask.dueAt });
        if (res?.success && res.task?.id) {
          setItems((prev) => prev.map((t) => (t.id === tempId ? res.task : t)));
        }
      } catch (err) {
        console.warn('Failed to add task:', err);
      }
    } else {
      // Notes tab
      const tempId = String(Date.now());
      const optimisticNote = { id: tempId, title: val, content: val, updatedAt: Date.now() };
      setNotes((prev) => [optimisticNote, ...prev]);
      setNewTitle('');

      try {
        const res = await window.electronAPI?.notesAdd?.({ title: val, content: val });
        if (res?.success && res.note?.id) {
          setNotes((prev) => prev.map((n) => (n.id === tempId ? res.note : n)));
        }
      } catch (err) {
        console.warn('Failed to add note:', err);
      }
    }
  };

  if (!visible) return null;

  const pendingCount = items.filter((t) => !t.completed).length;
  const filteredItems = items.filter((t) => {
    if (filter === 'pending') return !t.completed;
    if (filter === 'completed') return t.completed;
    return true;
  });

  return (
    <div className={`holo-tasks-wrapper ${exiting ? 'is-exiting' : ''}`}>
      <div className="holo-tasks-modal">
        {/* Header Bar with Tabs */}
        <div className="holo-tasks-header">
          <div className="holo-tasks-header-left" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="holo-tasks-pulse-dot" />
            <div style={{ display: 'flex', gap: '4px', background: 'rgba(0, 229, 255, 0.08)', padding: '2px 4px', borderRadius: '6px', border: '1px solid rgba(0, 229, 255, 0.2)' }}>
              <button
                type="button"
                onClick={() => setActiveTab('tasks')}
                style={{
                  background: activeTab === 'tasks' ? 'rgba(0, 229, 255, 0.25)' : 'transparent',
                  border: 'none',
                  color: activeTab === 'tasks' ? 'var(--j-accent, #00e5ff)' : 'rgba(255, 255, 255, 0.5)',
                  fontSize: '11px',
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                TASKS &amp; REMINDERS ({pendingCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('notes')}
                style={{
                  background: activeTab === 'notes' ? 'rgba(0, 229, 255, 0.25)' : 'transparent',
                  border: 'none',
                  color: activeTab === 'notes' ? 'var(--j-accent, #00e5ff)' : 'rgba(255, 255, 255, 0.5)',
                  fontSize: '11px',
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                NOTES ({notes.length})
              </button>
            </div>
          </div>

          <div className="holo-tasks-header-right">
            <button
              type="button"
              className="holo-tasks-close-btn"
              onClick={dismiss}
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Quick Add Pill */}
        <form className="holo-tasks-add-bar" onSubmit={handleSubmit}>
          <span className="holo-tasks-add-icon">＋</span>
          <input
            ref={inputRef}
            type="text"
            className="holo-tasks-add-input"
            placeholder={activeTab === 'tasks' ? 'Type a new reminder or task & hit Enter…' : 'Take a quick note & hit Enter…'}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          {newTitle.trim() && (
            <button type="submit" className="holo-tasks-add-submit">
              ADD
            </button>
          )}
        </form>

        {/* List Container */}
        <div className="holo-tasks-list-container">
          {activeTab === 'tasks' ? (
            filteredItems.length === 0 ? (
              <div className="holo-tasks-empty-state">
                <span className="holo-tasks-empty-icon">✓</span>
                <span>All caught up, Sir. No pending tasks.</span>
              </div>
            ) : (
              filteredItems.map((task) => {
                const due = formatDue(task.dueAt);
                return (
                  <div
                    key={task.id}
                    className={`holo-tasks-pill-item ${task.completed ? 'is-completed' : ''}`}
                    onClick={() => handleToggle(task.id)}
                  >
                    <button
                      type="button"
                      className={`holo-tasks-circle-btn ${task.completed ? 'is-checked' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggle(task.id);
                      }}
                      aria-label={task.completed ? 'Mark uncompleted' : 'Mark completed'}
                    >
                      {task.completed && (
                        <svg className="holo-tasks-check-svg" viewBox="0 0 16 16">
                          <polyline
                            points="3.5 8.5 6.5 11.5 12.5 5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>

                    <div className="holo-tasks-content">
                      <span className="holo-tasks-name">{task.title}</span>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        {due && <span className="holo-tasks-due-tag">{due}</span>}
                        {task.googleTaskId && (
                          <span style={{ fontSize: '10px', color: '#10b981', background: 'rgba(16, 185, 129, 0.15)', padding: '1px 6px', borderRadius: '4px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                            🌐 Google
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="holo-tasks-del-btn"
                      onClick={(e) => handleDeleteTask(e, task.id)}
                      title="Remove task"
                    >
                      ✕
                    </button>
                  </div>
                );
              })
            )
          ) : (
            notes.length === 0 ? (
              <div className="holo-tasks-empty-state">
                <span className="holo-tasks-empty-icon">📝</span>
                <span>No saved notes yet, Sir. Ask me to take a note anytime.</span>
              </div>
            ) : (
              notes.map((note) => (
                <div
                  key={note.id}
                  className="holo-tasks-pill-item"
                  style={{ cursor: 'default' }}
                >
                  <span style={{ fontSize: '14px', marginRight: '6px' }}>📝</span>
                  <div className="holo-tasks-content">
                    <span className="holo-tasks-name" style={{ fontWeight: 600 }}>{note.title}</span>
                    <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', marginTop: '2px', lineHeight: '1.3' }}>
                      {note.content}
                    </span>
                    <span style={{ fontSize: '9px', color: 'rgba(0, 229, 255, 0.7)', marginTop: '3px' }}>
                      {new Date(note.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="holo-tasks-del-btn"
                    onClick={(e) => handleDeleteNote(e, note.id)}
                    title="Remove note"
                  >
                    ✕
                  </button>
                </div>
              ))
            )
          )}
        </div>

        {/* Bottom Filter Pills (shown in tasks tab) */}
        {activeTab === 'tasks' && (
          <div className="holo-tasks-footer">
            <div className="holo-tasks-filter-pills">
              <button
                type="button"
                className={`holo-tasks-filter-pill ${filter === 'all' ? 'is-active' : ''}`}
                onClick={() => setFilter('all')}
              >
                All ({items.length})
              </button>
              <button
                type="button"
                className={`holo-tasks-filter-pill ${filter === 'pending' ? 'is-active' : ''}`}
                onClick={() => setFilter('pending')}
              >
                Pending ({pendingCount})
              </button>
              <button
                type="button"
                className={`holo-tasks-filter-pill ${filter === 'completed' ? 'is-active' : ''}`}
                onClick={() => setFilter('completed')}
              >
                Done ({items.length - pendingCount})
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
