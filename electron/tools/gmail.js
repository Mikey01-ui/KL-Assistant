/**
 * Gmail tool handlers.
 */
const { google } = require('googleapis');
const googleAuth = require('../googleAuth');
const { confirmAction } = require('../macTools');

function gmailClient(auth) {
  return google.gmail({ version: 'v1', auth });
}

function decodeBody(payload) {
  if (!payload) return '';
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }
  const parts = payload.parts || [];
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64url').toString('utf-8');
    }
  }
  for (const part of parts) {
    if (part.mimeType === 'text/html' && part.body?.data) {
      const html = Buffer.from(part.body.data, 'base64url').toString('utf-8');
      return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    if (part.parts) {
      const nested = decodeBody(part);
      if (nested) return nested;
    }
  }
  return '';
}

function headerMap(headers = []) {
  const map = {};
  headers.forEach((h) => { map[h.name.toLowerCase()] = h.value; });
  return map;
}

async function listMessages(params, queryExtra = '') {
  try {
    const auth = await googleAuth.getAuthClient();
    const gmail = gmailClient(auth);
    const maxResults = Math.min(25, parseInt(params.max_results, 10) || 5);
    const q = [params.query, queryExtra].filter(Boolean).join(' ').trim() || undefined;

    const list = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q,
      labelIds: params.label ? [params.label] : undefined,
    });

    const messages = list.data.messages || [];
    const isUnreadQuery = params.unread_only === 'true' || queryExtra.includes('is:unread');

    if (messages.length === 0) {
      const msg = isUnreadQuery
        ? 'You have no unread emails in your inbox, Sir.'
        : 'Your inbox is currently empty, Sir.';
      return { success: true, output: msg, spokenSummary: msg, count: 0 };
    }

    const lines = [];
    const parsedMessages = [];

    for (let i = 0; i < messages.length; i++) {
      const meta = await gmail.users.messages.get({
        userId: 'me',
        id: messages[i].id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date', 'List-Unsubscribe', 'List-ID', 'Feedback-ID', 'Precedence', 'Auto-Submitted'],
      });
      const h = headerMap(meta.data.payload?.headers);
      const snippet = meta.data.snippet || '';
      const cleanFrom = (h.from || '?').replace(/<[^>]+>/g, '').replace(/"/g, '').trim();
      const cleanSubj = h.subject || '(no subject)';
      const isAuto = isAutomatedEmail(h, cleanFrom);

      parsedMessages.push({
        id: meta.data.id,
        from: cleanFrom,
        subject: cleanSubj,
        date: h.date || '?',
        snippet,
        isAuto,
      });

      lines.push(
        `${i + 1}. [${meta.data.id}] ${cleanSubj}\n` +
        `   From: ${cleanFrom}${isAuto ? ' [Automated/Notification]' : ''}\n` +
        `   Date: ${h.date || '?'}\n` +
        `   ${snippet}`
      );
    }

    // Prioritize direct human correspondence or critical transactional emails over social/newsletters
    const directEmails = parsedMessages.filter(m => !m.isAuto);
    let spokenSummary = '';

    if (directEmails.length > 0) {
      const top = directEmails[0];
      if (directEmails.length === 1 && parsedMessages.length === 1) {
        spokenSummary = `You have 1 ${isUnreadQuery ? 'unread ' : ''}email from ${top.from} regarding ${top.subject}, Sir.`;
      } else {
        spokenSummary = `You have ${parsedMessages.length} ${isUnreadQuery ? 'unread ' : ''}emails, Sir. The priority is from ${top.from} regarding ${top.subject}.`;
      }
    } else {
      const senders = [...new Set(parsedMessages.map(m => m.from.split('@')[0].split(' ')[0]))].slice(0, 3).join(', ');
      spokenSummary = `You have ${parsedMessages.length} ${isUnreadQuery ? 'unread ' : ''}emails, Sir. They appear to be automated notifications and updates from ${senders || 'services'}.`;
    }

    return {
      success: true,
      output: `Found ${lines.length} ${isUnreadQuery ? 'unread ' : ''}message(s):\n\n${lines.join('\n\n')}`,
      spokenSummary,
      count: lines.length,
    };
  } catch (err) {
    return { success: false, error: err.message, spokenSummary: `I encountered an issue accessing your Gmail: ${err.message}, Sir.` };
  }
}

async function gmail_list(params) {
  return listMessages(params, params.unread_only === 'true' ? 'is:unread' : 'in:inbox');
}

async function gmail_search(params) {
  if (!params.query) return { success: false, error: 'Missing query' };
  return listMessages(params, '');
}

async function gmail_read(params) {
  const id = params.message_id || params.id;
  if (!id) return { success: false, error: 'Missing message_id' };

  const auth = await googleAuth.getAuthClient();
  const gmail = gmailClient(auth);
  const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
  const h = headerMap(msg.data.payload?.headers);
  const body = decodeBody(msg.data.payload).slice(0, 4000);

  return {
    success: true,
    output:
      `Message [${msg.data.id}]\n` +
      `Thread: ${msg.data.threadId}\n` +
      `From: ${h.from || '?'}\n` +
      `To: ${h.to || '?'}\n` +
      `Subject: ${h.subject || '(no subject)'}\n` +
      `Date: ${h.date || '?'}\n\n` +
      body,
  };
}

function buildRawEmail({ to, subject, body, inReplyTo, references, threadId }) {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
  ];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push('', body || '');
  const raw = Buffer.from(lines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return { raw, threadId };
}

async function gmail_draft_reply(params) {
  const messageId = params.message_id || params.id;
  const body = params.body || params.content || '';
  if (!messageId) return { success: false, error: 'Missing message_id' };
  if (!body) return { success: false, error: 'Missing body' };

  const auth = await googleAuth.getAuthClient();
  const gmail = gmailClient(auth);
  const original = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'metadata',
    metadataHeaders: ['From', 'To', 'Subject', 'Message-ID', 'References'],
  });
  const h = headerMap(original.data.payload?.headers);
  const to = params.to || h.from;
  let subject = params.subject || h.subject || '';
  if (subject && !/^re:/i.test(subject)) subject = `Re: ${subject}`;

  const message = buildRawEmail({
    to,
    subject,
    body,
    inReplyTo: h['message-id'],
    references: [h.references, h['message-id']].filter(Boolean).join(' '),
    threadId: original.data.threadId,
  });

  const draft = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: {
        raw: message.raw,
        threadId: original.data.threadId,
      },
    },
  });

  return {
    success: true,
    output: `Draft reply created [${draft.data.id}] to ${to} — subject "${subject}". Use gmail_send with draft_id to send.`,
  };
}

async function gmail_send(params, getMainWindow) {
  const auth = await googleAuth.getAuthClient();
  const gmail = gmailClient(auth);

  // Send existing draft
  if (params.draft_id) {
    const confirmed = await confirmAction(
      getMainWindow(),
      `Send draft ${params.draft_id}?`
    );
    if (!confirmed) return { success: false, output: 'Action cancelled by user.' };
    const sent = await gmail.users.drafts.send({
      userId: 'me',
      requestBody: { id: params.draft_id },
    });
    return { success: true, output: `Sent message [${sent.data.id}]` };
  }

  const to = params.to;
  const subject = params.subject || '(no subject)';
  const body = params.body || params.content || '';
  if (!to) return { success: false, error: 'Missing to (or draft_id)' };

  const confirmed = await confirmAction(
    getMainWindow(),
    `Send email to ${to}?\n\nSubject: ${subject}\n\n${body.slice(0, 300)}`
  );
  if (!confirmed) return { success: false, output: 'Action cancelled by user.' };

  const message = buildRawEmail({ to, subject, body });
  const sent = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: message.raw },
  });
  return { success: true, output: `Sent message [${sent.data.id}] to ${to}` };
}

function detectSpam(headers, snippet) {
  const subject = (headers.subject || '').toLowerCase();
  const from = (headers.from || '').toLowerCase();
  const text = (subject + ' ' + (snippet || '')).toLowerCase();

  const spamTriggers = [
    'viagra', 'casino', 'lottery', 'wire transfer', 'crypto giveaway',
    'guaranteed profit', 'claim your prize', 'claim your reward', 'inheritance',
    'earn cash fast', 'weight loss secret', 'account suspended click here',
    'verify password', 'urgent notice: update billing', 'bitcoin gift',
    'western union transfer', 'you have won', 'congratulations winner',
    '100% free bonus', 'hot singles', 'meet singles', 'escort service',
    'pills online', 'cheap pharmacy', 'unsolicited loan'
  ];

  for (const trigger of spamTriggers) {
    if (text.includes(trigger)) {
      return `Contains spam trigger keyword: "${trigger}"`;
    }
  }

  // Suspicious phishing checks
  if (
    (text.includes('urgent action required') || text.includes('security breach') || text.includes('account suspended')) &&
    (text.includes('click here to verify') || text.includes('log in now') || text.includes('confirm identity')) &&
    !from.includes('google.com') && !from.includes('apple.com') && !from.includes('microsoft.com') && !from.includes('github.com')
  ) {
    return 'Suspected phishing or fraudulent security notification';
  }

  return null;
}

const SOCIAL_AND_MARKETING_DOMAINS = [
  'pinterest.com', 'facebookmail.com', 'instagram.com', 'twitter.com', 'x.com',
  'linkedin.com', 'redditmail.com', 'quora.com', 'tiktok.com', 'medium.com',
  'tumblr.com', 'youtube.com', 'twitch.tv', 'discord.com', 'steamcommunity.com',
  'temu.com', 'aliexpress.com', 'wish.com', 'shein.com', 'groupon.com',
  'uber.com', 'lyft.com', 'doordash.com', 'grubhub.com', 'booking.com',
  'tripadvisor.com', 'canva.com', 'grammarly.com', 'duolingo.com', 'spotify.com'
];

function isAutomatedEmail(headers = {}, fromStr = '') {
  const from = (fromStr || '').toLowerCase();

  // 1. Social networks and marketing platforms
  if (SOCIAL_AND_MARKETING_DOMAINS.some(domain => from.includes(domain))) {
    return true;
  }

  // 2. Automated sender aliases
  const automatedAliases = [
    'noreply', 'no-reply', 'donotreply', 'mailer-daemon', 'bounce',
    'notifications@', 'notification@', 'notify@', 'marketing@',
    'newsletter@', 'promotions@', 'news@', 'digest@', 'pinbot@',
    'explore@', 'inspiration@', 'updates@', 'mailer@', 'hello@',
    'info@', 'team@', 'community@', 'alerts@', 'automated@'
  ];
  if (automatedAliases.some(alias => from.includes(alias))) {
    return true;
  }

  // 3. RFC and ESP marketing headers
  if (
    headers['list-unsubscribe'] ||
    headers['list-id'] ||
    headers['feedback-id'] ||
    headers['auto-submitted'] ||
    headers['precedence'] === 'bulk' ||
    headers['precedence'] === 'list' ||
    headers['x-autoreply'] ||
    headers['x-autorespond']
  ) {
    return true;
  }

  return false;
}

function extractActionRequest(text) {
  if (!text) return null;
  const questions = text.match(/[^.!?\n]+(?:\?)/g);
  if (questions && questions.length > 0) {
    return questions[0].trim();
  }
  const actionTriggers = [
    'let me know', 'could you', 'can you', 'please check',
    'please confirm', 'waiting on', 'waiting for', 'thoughts on',
    'feedback on', 'by tomorrow', 'by friday', 'by end of day',
    'need your input', 'are you free', 'available to meet'
  ];
  for (const trigger of actionTriggers) {
    const idx = text.toLowerCase().indexOf(trigger);
    if (idx !== -1) {
      return text.slice(idx, idx + 100).trim();
    }
  }
  return null;
}

async function gmail_organize_inbox(params) {
  try {
    const auth = await googleAuth.getAuthClient();
    const gmail = gmailClient(auth);
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const userEmail = (profile.data?.emailAddress || '').toLowerCase();

    const maxResults = Math.min(30, parseInt(params.max_results, 10) || 15);
    const list = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q: 'in:inbox',
    });

    const messages = list.data.messages || [];
    if (messages.length === 0) {
      return { success: true, output: 'Your inbox is currently empty, Sir.' };
    }

    const categories = {
      needsReply: [],
      important: [],
      newsletters: [],
      spam: [],
      general: [],
    };

    for (const item of messages) {
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id: item.id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date', 'List-Unsubscribe', 'List-ID', 'Feedback-ID', 'Precedence', 'Auto-Submitted'],
      });

      const h = headerMap(msg.data.payload?.headers);
      const from = h.from || '';
      const to = h.to || '';
      const subject = h.subject || '(no subject)';
      const dateStr = h.date || '';
      const snippet = msg.data.snippet || '';

      const receivedDate = new Date(dateStr);
      const diffMs = Date.now() - (isNaN(receivedDate.getTime()) ? Date.now() : receivedDate.getTime());
      const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
      const timeAgo = diffDays > 0 ? `${diffDays} day${diffDays === 1 ? '' : 's'} ago` : 'today';

      const emailObj = {
        id: item.id,
        threadId: msg.data.threadId,
        from,
        to,
        subject,
        timeAgo,
        diffDays,
        snippet,
      };

      // 1. Spam detection
      const spamReason = detectSpam(h, snippet);
      if (spamReason) {
        emailObj.reason = spamReason;
        categories.spam.push(emailObj);
        continue;
      }

      // 2. Automated newsletter / marketing detection (including social networks like Pinterest)
      if (isAutomatedEmail(h, from)) {
        categories.newsletters.push(emailObj);
        continue;
      }

      // 3. Needs Reply check (direct message to user from someone else with an action item or question)
      const isFromMe = from.toLowerCase().includes(userEmail);
      if (!isFromMe) {
        const actionReq = extractActionRequest(subject + ' ' + snippet);
        if (actionReq) {
          emailObj.actionRequest = actionReq;
          categories.needsReply.push(emailObj);
          continue;
        }
      }

      // 4. Important items (urgent, invoices, meetings)
      if (/\b(urgent|asap|important|invoice|statement|flight|reservation|calendar|invitation|security alert)\b/i.test(subject)) {
        categories.important.push(emailObj);
      } else {
        categories.general.push(emailObj);
      }
    }

    const sections = [];
    sections.push(`Inbox Triage (${messages.length} messages analyzed):`);

    if (categories.needsReply.length > 0) {
      sections.push(`\n⏳ AWAITING YOUR REPLY (${categories.needsReply.length}):`);
      categories.needsReply.forEach((e, idx) => {
        sections.push(
          `${idx + 1}. [${e.id}] From: ${e.from} (${e.timeAgo})\n` +
          `   Subject: ${e.subject}\n` +
          `   Note: ${e.actionRequest}`
        );
      });
    }

    if (categories.important.length > 0) {
      sections.push(`\n📌 IMPORTANT / ACTION ITEMS (${categories.important.length}):`);
      categories.important.forEach((e, idx) => {
        sections.push(`${idx + 1}. [${e.id}] ${e.subject} — From: ${e.from} (${e.timeAgo})`);
      });
    }

    if (categories.spam.length > 0) {
      sections.push(`\n🛑 DETECTED SPAM / SUSPICIOUS (${categories.spam.length}):`);
      categories.spam.forEach((e, idx) => {
        sections.push(`${idx + 1}. [${e.id}] ${e.subject} — From: ${e.from} [Reason: ${e.reason}]`);
      });
    }

    if (categories.newsletters.length > 0) {
      sections.push(`\n📰 SUBSCRIPTIONS & MARKETING (${categories.newsletters.length}):`);
      categories.newsletters.slice(0, 5).forEach((e, idx) => {
        sections.push(`${idx + 1}. [${e.id}] ${e.subject} — ${e.from}`);
      });
      if (categories.newsletters.length > 5) {
        sections.push(`   ...and ${categories.newsletters.length - 5} more.`);
      }
    }

    if (categories.general.length > 0) {
      sections.push(`\n📨 OTHER INBOX ITEMS (${categories.general.length} messages)`);
    }

    const spokenSummary = `I have organized your inbox, Sir. You have ${categories.needsReply.length} email${categories.needsReply.length === 1 ? '' : 's'} awaiting reply, ${categories.important.length} important item${categories.important.length === 1 ? '' : 's'}, and ${categories.spam.length} detected spam.`;

    return {
      success: true,
      output: sections.join('\n'),
      spokenSummary,
    };
  } catch (err) {
    return { success: false, error: err.message, spokenSummary: `I encountered an issue organizing your inbox: ${err.message}, Sir.` };
  }
}

async function gmail_find_unreplied(params) {
  try {
    const auth = await googleAuth.getAuthClient();
    const gmail = gmailClient(auth);
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const userEmail = (profile.data?.emailAddress || '').toLowerCase();

    const maxResults = Math.min(25, parseInt(params.max_results, 10) || 15);
    const days = parseInt(params.days, 10) || 14;

    const list = await gmail.users.threads.list({
      userId: 'me',
      q: 'in:inbox',
      maxResults,
    });

    const threads = list.data.threads || [];
    if (threads.length === 0) {
      const msg = 'No active threads found in your inbox, Sir.';
      return { success: true, output: msg, spokenSummary: msg };
    }

    const unreplied = [];

    for (const t of threads) {
      const fullThread = await gmail.users.threads.get({
        userId: 'me',
        id: t.id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date', 'List-Unsubscribe', 'List-ID', 'Feedback-ID', 'Precedence', 'Auto-Submitted'],
      });

      const msgs = fullThread.data.messages || [];
      if (msgs.length === 0) continue;

      const lastMsg = msgs[msgs.length - 1];
      const h = headerMap(lastMsg.payload?.headers);
      const from = (h.from || '').toLowerCase();

      // If user was the last one to reply, skip
      if (userEmail && from.includes(userEmail)) {
        continue;
      }

      // If automated newsletter, marketing, or social notification (e.g. Pinterest), skip
      if (isAutomatedEmail(h, h.from)) {
        continue;
      }

      const subject = h.subject || '(no subject)';
      const dateStr = h.date || '';
      const receivedDate = new Date(dateStr);
      const diffMs = Date.now() - (isNaN(receivedDate.getTime()) ? Date.now() : receivedDate.getTime());
      const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

      if (diffDays > days) continue;

      const timeAgo = diffDays === 0 ? 'earlier today' : `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
      const actionReq = extractActionRequest(subject + ' ' + (lastMsg.snippet || ''));
      if (!actionReq) continue;

      unreplied.push({
        id: lastMsg.id,
        threadId: t.id,
        from: h.from || 'Unknown',
        subject,
        timeAgo,
        diffDays,
        snippet: lastMsg.snippet || '',
        actionReq,
      });
    }

    if (unreplied.length === 0) {
      const msg = `You have no pending or forgotten emails requiring a reply for the past ${days} days, Sir.`;
      return {
        success: true,
        output: msg,
        spokenSummary: msg,
      };
    }

    // Sort by oldest unreplied first
    unreplied.sort((a, b) => b.diffDays - a.diffDays);

    const lines = [
      `Found ${unreplied.length} important email(s) awaiting your response:\n`,
    ];

    unreplied.forEach((item, i) => {
      lines.push(
        `${i + 1}. [${item.id}] From: ${item.from}\n` +
        `   Received: ${item.timeAgo}\n` +
        `   Subject: ${item.subject}\n` +
        `   Status: ${item.actionReq}\n` +
        `   Excerpt: "${item.snippet.slice(0, 120)}..."`
      );
    });

    lines.push('\nWould you like me to draft a response to any of these for you, Sir?');

    const oldest = unreplied[0];
    const cleanOldestFrom = (oldest.from || 'a contact').replace(/<[^>]+>/g, '').replace(/"/g, '').trim();
    const spokenSummary = unreplied.length === 1
      ? `You have 1 email awaiting your reply from ${cleanOldestFrom} regarding ${oldest.subject}, Sir.`
      : `You have ${unreplied.length} emails awaiting your reply, Sir. The oldest is from ${cleanOldestFrom} regarding ${oldest.subject}.`;

    return {
      success: true,
      output: lines.join('\n'),
      spokenSummary,
    };
  } catch (err) {
    return { success: false, error: err.message, spokenSummary: `I encountered an issue checking your emails: ${err.message}, Sir.` };
  }
}

async function gmail_mark_spam(params) {
  try {
    const rawIds = params.message_ids || params.message_id || params.id;
    if (!rawIds) return { success: false, error: 'Missing message_ids' };
    const ids = String(rawIds).split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return { success: false, error: 'No valid message IDs provided' };

    const auth = await googleAuth.getAuthClient();
    const gmail = gmailClient(auth);

    if (ids.length === 1) {
      await gmail.users.messages.modify({
        userId: 'me',
        id: ids[0],
        requestBody: {
          addLabelIds: ['SPAM'],
          removeLabelIds: ['INBOX'],
        },
      });
    } else {
      await gmail.users.messages.batchModify({
        userId: 'me',
        requestBody: {
          ids,
          addLabelIds: ['SPAM'],
          removeLabelIds: ['INBOX'],
        },
      });
    }

    return {
      success: true,
      output: `Moved ${ids.length} email(s) to Spam successfully, Sir.`,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function gmail_archive(params) {
  try {
    const rawIds = params.message_ids || params.message_id || params.id;
    if (!rawIds) return { success: false, error: 'Missing message_ids' };
    const ids = String(rawIds).split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return { success: false, error: 'No valid message IDs provided' };

    const auth = await googleAuth.getAuthClient();
    const gmail = gmailClient(auth);

    if (ids.length === 1) {
      await gmail.users.messages.modify({
        userId: 'me',
        id: ids[0],
        requestBody: {
          removeLabelIds: ['INBOX'],
        },
      });
    } else {
      await gmail.users.messages.batchModify({
        userId: 'me',
        requestBody: {
          ids,
          removeLabelIds: ['INBOX'],
        },
      });
    }

    return {
      success: true,
      output: `Archived ${ids.length} email(s) from your inbox, Sir.`,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function createGmailHandlers(getMainWindow) {
  return {
    gmail_list: (params) => gmail_list(params),
    gmail_search: (params) => gmail_search(params),
    gmail_read: (params) => gmail_read(params),
    gmail_draft_reply: (params) => gmail_draft_reply(params),
    gmail_send: (params) => gmail_send(params, getMainWindow),
    gmail_organize_inbox: (params) => gmail_organize_inbox(params),
    gmail_find_unreplied: (params) => gmail_find_unreplied(params),
    gmail_mark_spam: (params) => gmail_mark_spam(params),
    gmail_archive: (params) => gmail_archive(params),
  };
}

module.exports = { createGmailHandlers };
