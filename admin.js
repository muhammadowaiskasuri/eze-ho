import { supabase, ADMIN_EMAIL } from './supabase-init.js'

let allSubmissions = []
let currentFilter = 'all'
let realtimeChannel = null

// ── AUTH GUARD ────────────────────────────────────────
;(async () => {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session || session.user.email !== ADMIN_EMAIL) {
    window.location.href = 'index.html'; return
  }
  await loadSubmissions()
  await loadUsers()
  await loadOcrConfig()
  startRealtime()
})()

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') window.location.href = 'index.html'
})

// ── REALTIME ──────────────────────────────────────────
function startRealtime() {
  realtimeChannel = supabase
    .channel('admin-channel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, () => loadSubmissions())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'replies' }, () => loadSubmissions())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => loadUsers())
    .subscribe()
}

// ── LOAD SUBMISSIONS ──────────────────────────────────
async function loadSubmissions() {
  const { data: submissions, error } = await supabase
    .from('submissions').select('*').order('created_at', { ascending: false })

  if (error) {
    document.getElementById('adminSubmissionsList').innerHTML =
      `<p class="error-msg" style="padding:16px">Error: ${error.message}</p>`
    return
  }

  allSubmissions = submissions || []

  // Fetch all replies
  const { data: replies } = await supabase.from('replies').select('*').order('created_at', { ascending: false })
  window._allReplies = replies || []

  renderSubmissions()
}

function renderSubmissions() {
  const container = document.getElementById('adminSubmissionsList')
  let list = allSubmissions
  if (currentFilter === 'pending') list = list.filter(s => !s.has_reply)
  if (currentFilter === 'replied') list = list.filter(s => s.has_reply)

  if (!list.length) {
    container.innerHTML = '<p class="empty-msg">No submissions found.</p>'
    return
  }

  const replies = window._allReplies || []

  container.innerHTML = list.map(s => {
    const ts = new Date(s.created_at).toLocaleString()
    const subReplies = replies.filter(r => r.submission_id === s.id)
    const extraFields = [
      s.field_username ? `<span class="sub-field"><strong>Username:</strong> ${esc(s.field_username)}</span>` : '',
      s.field_password ? `<span class="sub-field"><strong>Password:</strong> ${esc(s.field_password)}</span>` : '',
      s.field_received_by ? `<span class="sub-field"><strong>Received By:</strong> ${esc(s.field_received_by)}</span>` : ''
    ].filter(Boolean).join('')

    const repliesHtml = subReplies.length ? `
      <div class="admin-replies">
        <h4 class="replies-title">Replies Sent</h4>
        ${subReplies.map(r => `
          <div class="reply-card">
            <p>${esc(r.message)}</p>
            ${r.attachment_url ? `<a href="${r.attachment_url}" target="_blank" class="file-link">📎 ${r.attachment_name||'Attachment'}</a>` : ''}
            <small>${new Date(r.created_at).toLocaleString()}</small>
          </div>`).join('')}
      </div>` : ''

    return `<div class="submission-card admin-sub">
      <div class="submission-header">
        <div>
          <strong>${esc(s.user_name || '—')}</strong>
          <small style="margin-left:8px;color:var(--muted)">${esc(s.user_email || '')} · ${ts}</small>
        </div>
        <span class="status-badge ${s.has_reply ? 'replied' : 'pending'}">${s.has_reply ? '✅ Replied' : '⏳ Pending'}</span>
      </div>
      <p class="submission-text">${esc(s.text || '')}</p>
      ${extraFields ? `<div class="sub-fields-row">${extraFields}</div>` : ''}
      ${s.zip_file_url ? `<div class="file-links" style="margin-top:14px"><a href="${s.zip_file_url}" class="file-link" style="background:var(--primary);color:white;border:none;">📦 Download Full ZIP</a></div>` : (s.file_urls?.length ? `<div class="file-links">${s.file_urls.map(f=>`<a href="${f.url}" target="_blank" class="file-link">📎 ${f.name}</a>`).join('')}</div>` : '')}
      ${repliesHtml}
      <button class="btn-reply" onclick="openReplyModal('${s.id}')">💬 Reply</button>
    </div>`
  }).join('')
}

// ── LOAD USERS ────────────────────────────────────────
async function loadUsers() {
  const { data: users, error } = await supabase
    .from('users').select('*').order('created_at', { ascending: false })

  const container = document.getElementById('usersList')
  if (error) {
    container.innerHTML = `<p class="error-msg" style="padding:16px">Error: ${error.message}</p>`
    return
  }
  if (!users || !users.length) {
    container.innerHTML = '<p class="empty-msg">No users registered yet.</p>'
    return
  }

  container.innerHTML = `<div class="table-wrap"><table class="users-table">
    <thead><tr><th>Name</th><th>Email</th><th>Credits</th><th>Joined</th><th>Action</th></tr></thead>
    <tbody>${users.map(u => {
      const ts = new Date(u.created_at).toLocaleDateString()
      return `<tr>
        <td>${esc(u.name||'—')}</td>
        <td>${esc(u.email||'—')}</td>
        <td><span class="credit-pill"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:sub;margin-right:2px;"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg> ${u.credits??0}</span></td>
        <td>${ts}</td>
        <td><button class="btn-add-credits" onclick="openCreditsModal('${u.id}','${esc(u.name||'')}',${u.credits??0})">Manage</button></td>
      </tr>`
    }).join('')}</tbody>
  </table></div>`
}

// ── REPLY MODAL ───────────────────────────────────────
window.openReplyModal = (submissionId) => {
  document.getElementById('replySubmissionId').value = submissionId
  document.getElementById('replyMessage').value = ''
  document.getElementById('replyFile').value = ''
  document.getElementById('replyProgressWrapper').style.display = 'none'
  document.getElementById('replyModal').style.display = 'flex'
}
window.closeReplyModal = () => { document.getElementById('replyModal').style.display = 'none' }

window.sendReply = async () => {
  const submissionId = document.getElementById('replySubmissionId').value
  const message = document.getElementById('replyMessage').value.trim()
  const files = document.getElementById('replyFile').files
  const btn = document.getElementById('sendReplyBtn')
  if (!message) { showToast('Please enter a reply message.', 'error'); return }
  btn.disabled = true; btn.textContent = 'Sending...'

  let attachmentUrls = [] // storing multiple files
  if (files.length > 0) {
    document.getElementById('replyProgressWrapper').style.display = 'flex'
    document.getElementById('replyProgressFill').style.width = '0%'
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const path = `replies/${submissionId}/${Date.now()}_${file.name}`
        document.getElementById('replyProgressText').textContent = `Uploading ${i+1}/${files.length}`
        
        const { error: upErr } = await supabase.storage.from('uploads').upload(path, file)
        if (upErr) {
          showToast(`File upload failed: ${file.name} - ${upErr.message}`, 'error')
          btn.disabled = false; btn.textContent = 'Send Reply'; return
        }
        const { data: urlData } = supabase.storage.from('uploads').getPublicUrl(path)
        attachmentUrls.push({ name: file.name, url: urlData.publicUrl, path: path })
        document.getElementById('replyProgressFill').style.width = Math.round(((i+1)/files.length)*100) + '%'
    }
    document.getElementById('replyProgressWrapper').style.display = 'none'
  }

  const { error: repErr } = await supabase.from('replies').insert({
    submission_id: submissionId,
    message,
    attachment_urls: attachmentUrls,
    attachment_url: attachmentUrls.length === 1 ? attachmentUrls[0].url : null,
    attachment_name: attachmentUrls.length === 1 ? attachmentUrls[0].name : null
  })

  if (repErr) {
    showToast('Error sending reply: ' + repErr.message, 'error')
    btn.disabled = false; btn.textContent = 'Send Reply'; return
  }

  await supabase.from('submissions').update({ has_reply: true }).eq('id', submissionId)

  showToast('✅ Reply sent!', 'success')
  closeReplyModal()
  await loadSubmissions()
  btn.disabled = false; btn.textContent = 'Send Reply'
}

// ── CREDITS MODAL ─────────────────────────────────────
window.openCreditsModal = (userId, userName, currentCredits) => {
  document.getElementById('creditUserId').value = userId
  document.getElementById('creditUserName').textContent = `${userName} — Current: 🪙 ${currentCredits}`
  document.getElementById('creditAmount').value = 10
  document.getElementById('creditsModal').style.display = 'flex'
}
window.closeCreditsModal = () => { document.getElementById('creditsModal').style.display = 'none' }

window.updateCredits = async () => {
  const userId = document.getElementById('creditUserId').value
  const amount = parseInt(document.getElementById('creditAmount').value)
  const action = document.getElementById('creditAction').value
  if (!amount || amount < 1) { showToast('Enter a valid positive amount.', 'error'); return }

  // Get current credits
  const { data: u } = await supabase.from('users').select('credits').eq('id', userId).maybeSingle()
  let newCredits = (u?.credits ?? 0)
  
  if (action === 'add') {
    newCredits += amount
  } else {
    newCredits -= amount
    if (newCredits < 0) newCredits = 0
  }

  const { error } = await supabase.from('users').update({ credits: newCredits }).eq('id', userId)

  if (error) { showToast('Error: ' + error.message, 'error'); return }
  showToast(`✅ Credits updated successfully!`, 'success')
  closeCreditsModal()
  await loadUsers()
}

// ── TABS & FILTERS ────────────────────────────────────
window.switchTab = (tab, el) => {
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'))
  document.querySelectorAll('[id^="tab-"]').forEach(s => s.style.display = 'none')
  el.classList.add('active')
  document.getElementById(`tab-${tab}`).style.display = 'block'
}

window.filterSubs = (filter, el) => {
  currentFilter = filter
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'))
  el.classList.add('active')
  renderSubmissions()
}

window.handleLogout = async () => {
  if (realtimeChannel) supabase.removeChannel(realtimeChannel)
  await supabase.auth.signOut()
  window.location.href = 'index.html'
}

function esc(s = '') {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

window.showToast = (msg, type = 'info') => {
  const t = document.getElementById('toast')
  t.textContent = msg; t.className = `toast show ${type}`
  setTimeout(() => t.classList.remove('show'), 4000)
}

// ── OCR CONFIG ────────────────────────────────────────
async function loadOcrConfig() {
  try {
    const res = await fetch('/ocr-provider')
    if (res.ok) {
      const config = await res.json()
      if (document.getElementById('activeOcrProvider')) {
        document.getElementById('activeOcrProvider').value = config.activeProvider || 'roboflow'
      }
      if (document.getElementById('activeOcrBadge')) {
        const provMap = { 'roboflow': 'RoboFlow', 'ocr.space': 'OCR.space' }
        document.getElementById('activeOcrBadge').textContent = 'OCR: ' + (provMap[config.activeProvider || 'roboflow'] || config.activeProvider)
      }
    }
  } catch (err) {
    console.error('Failed to load OCR config', err)
  }
}

window.updateOcrProvider = async () => {
  const provider = document.getElementById('activeOcrProvider').value
  const btn = document.getElementById('saveOcrBtn')
  btn.disabled = true; btn.textContent = 'Saving...'
  try {
    const res = await fetch('/ocr-provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeProvider: provider })
    })
    if (res.ok) {
      showToast('✅ OCR Config saved successfully!', 'success')
      // Also update the global object if admin does OCR locally
      if (window.OCR_CONFIG) window.OCR_CONFIG.provider = provider
      if (document.getElementById('activeOcrBadge')) {
        const provMap = { 'roboflow': 'RoboFlow', 'ocr.space': 'OCR.space' }
        document.getElementById('activeOcrBadge').textContent = 'OCR: ' + (provMap[provider] || provider)
      }
    } else {
      showToast('Failed to save OCR config.', 'error')
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error')
  }
  btn.disabled = false; btn.textContent = 'Save Configuration'
}

