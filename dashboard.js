import { supabase, ADMIN_EMAIL } from './supabase-init.js'

let currentUser = null
let selectedFiles = []
let realtimeChannel = null

// ── AUTH GUARD ────────────────────────────────────────
;(async () => {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) { window.location.href = 'index.html'; return }
  if (session.user.email === ADMIN_EMAIL) { window.location.href = 'admin.html'; return }
  currentUser = session.user
  await loadUserData()
  await loadSubmissions()
  startRealtime()
})()

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') window.location.href = 'index.html'
})

// ── USER DATA ─────────────────────────────────────────
async function loadUserData() {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', currentUser.id)
    .maybeSingle()

  if (error || !data) {
    showError('Could not load profile. Check Supabase setup.')
    return
  }
  document.getElementById('userNameDisplay').textContent = data.name
  document.getElementById('userEmailDisplay').textContent = data.email
  document.getElementById('creditDisplay').textContent = data.credits ?? 0
}

// ── REALTIME ──────────────────────────────────────────
function startRealtime() {
  realtimeChannel = supabase
    .channel('user-data-' + currentUser.id)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'users',
      filter: `id=eq.${currentUser.id}`
    }, (payload) => {
      if (payload.new) {
        document.getElementById('creditDisplay').textContent = payload.new.credits ?? 0
      }
    })
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'submissions',
      filter: `user_id=eq.${currentUser.id}`
    }, () => loadSubmissions())
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'replies'
    }, () => loadSubmissions())
    .subscribe()
}

// ── FILE SELECTION ────────────────────────────────────
document.getElementById('fileDropArea').addEventListener('click', () => {
  document.getElementById('fileInput').click()
})

 window.handleFileSelect = (input) => {
  const files = Array.from(input.files)
  if (files.length > 500) { showToast('Max 500 files allowed.', 'error'); return }
  const allowed = ['image/jpeg','image/png','image/jpg','application/pdf',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain']
  for (const f of files) {
    if (!allowed.includes(f.type)) { showToast(`"${f.name}" type not allowed.`, 'error'); input.value=''; return }
    if (f.size > 5*1024*1024) { showToast(`"${f.name}" exceeds 5MB.`, 'error'); input.value=''; return }
  }
  // Append new files instead of replacing if user selects again
  selectedFiles = selectedFiles.concat(files).slice(0, 500); 
  renderFileList()
}

function renderFileList() {
  if (selectedFiles.length === 0) {
    document.getElementById('fileList').innerHTML = '';
    return;
  }
  const totalSize = selectedFiles.reduce((acc, f) => acc + f.size, 0);
  document.getElementById('fileList').innerHTML = `
    <div class="file-item" style="justify-content:center; gap:16px; padding: 12px; background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.2);">
      <span>📦 <strong>${selectedFiles.length} files selected</strong> <span style="color:var(--muted); font-size:0.85rem; margin-left:6px;">(${(totalSize/(1024*1024)).toFixed(2)} MB)</span></span>
      <button type="button" onclick="clearFiles()" style="color:var(--danger); font-weight:bold; font-size:1.1rem" title="Clear all files">✕</button>
    </div>`
}

window.clearFiles = () => { selectedFiles = []; document.getElementById('fileInput').value = ''; renderFileList() }

// ── SUBMIT ────────────────────────────────────────────
window.handleSubmit = async (e) => {
  e.preventDefault()
  hideError()

  const fieldUsername = document.getElementById('fieldUsername').value.trim()
  const fieldPassword = document.getElementById('fieldPassword').value.trim()
  const fieldReceivedBy = document.getElementById('fieldReceivedBy').value.trim()
  
  if (!fieldUsername || !fieldPassword || !fieldReceivedBy) {
    showError('Please fill in all the required text details (Username, Password, and Received By).')
    return
  }
  
  if (selectedFiles.length === 0) {
    showError('Please attach at least one file before submitting.')
    return
  }
  
  const text = fieldUsername;

  const btn = document.getElementById('submitBtn')
  btn.disabled = true; btn.textContent = 'Checking credits...'

  // Check credits
  const { data: userData, error: uErr } = await supabase
    .from('users').select('credits, name').eq('id', currentUser.id).maybeSingle()

  if (uErr || !userData) {
    showError('Could not verify credits. Please contact admin.')
    btn.disabled = false; btn.textContent = '🚀 Submit'; return
  }
  const creditsNeeded = Math.max(1, selectedFiles.length);

  if ((userData.credits ?? 0) < creditsNeeded) {
    document.getElementById('noCreditsModal').style.display = 'flex'
    document.querySelector('#noCreditsModal p').textContent = `You need ${creditsNeeded} credit(s) to submit this amount of files, but you only have ${userData.credits ?? 0}. Please add balance.`;
    btn.disabled = false; btn.textContent = '🚀 Submit'; return
  }

  // Create ZIP and Upload
  let zipFileUrl = null
  let fallbackFileUrls = [] // in case of zero files

  if (selectedFiles.length > 0 || fieldUsername || fieldPassword) {
    showProgress(5)
    btn.textContent = 'Generating Secure ZIP...'
    
    // Check if JSZip exists
    if (typeof JSZip === 'undefined') {
      showError('JSZip is not loaded. Please ensure internet connection or check setup.')
      btn.disabled = false; btn.textContent = '🚀 Submit'; return
    }
    
    try {
      const zip = new JSZip()
      
      // Add text details
      const detailsContent = `Username: ${fieldUsername}
Password: ${fieldPassword}
Received By: ${fieldReceivedBy}
`
      zip.file("details.txt", detailsContent)
      
      // Add all user files
      for(let i=0; i<selectedFiles.length; i++) {
        zip.file(selectedFiles[i].name, selectedFiles[i])
      }
      
      setProgress(20)
      
      // Generate ZIP blob
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, (meta) => {
         setProgress(20 + Math.round(meta.percent * 0.4))
      })
      
      setProgress(65)
      btn.textContent = 'Uploading ZIP...'
      
      const zipName = `${Date.now()}_submission.zip`
      const path = `${currentUser.id}/${zipName}`
      const { error: upErr } = await supabase.storage.from('uploads').upload(path, zipBlob)
      if (upErr) {
        hideProgress()
        showError(`Upload failed: ${upErr.message}`)
        btn.disabled = false; btn.textContent = '🚀 Submit'; return
      }
      
      const { data: urlData } = supabase.storage.from('uploads').getPublicUrl(path)
      zipFileUrl = urlData.publicUrl
      setProgress(85)
    } catch(err) {
      hideProgress()
      showError(`ZIP Generation Error: ${err.message}`)
      btn.disabled = false; btn.textContent = '🚀 Submit'; return
    }
  }

  // Save submission
  btn.textContent = 'Saving...'
  setProgress(90)

  const { error: subErr } = await supabase.from('submissions').insert({
    user_id: currentUser.id,
    user_name: userData.name,
    user_email: currentUser.email,
    text,
    field_username: fieldUsername,
    field_password: fieldPassword,
    field_received_by: fieldReceivedBy,
    zip_file_url: zipFileUrl,
    file_urls: fallbackFileUrls, // keep empty or null due to schema safety
    status: 'pending',
    has_reply: false
  })

  if (subErr) {
    hideProgress()
    showError('Submission failed: ' + subErr.message)
    btn.disabled = false; btn.textContent = '🚀 Submit'; return
  }

  // Deduct credits
  await supabase.from('users').update({ credits: (userData.credits - creditsNeeded) }).eq('id', currentUser.id)
  // Refresh credit display
  loadUserData()

  setProgress(100)
  setTimeout(hideProgress, 600)
  showToast(`✅ Submitted! ${creditsNeeded} credit(s) used.`, 'success')

  // Reset form
  document.getElementById('fieldUsername').value = ''
  document.getElementById('fieldPassword').value = ''
  document.getElementById('fieldReceivedBy').value = ''
  selectedFiles = []; renderFileList()
  document.getElementById('fileInput').value = ''
  hideError()
  await loadSubmissions()

  btn.disabled = false; btn.textContent = '🚀 Submit'
}

// ── LOAD SUBMISSIONS ──────────────────────────────────
async function loadSubmissions() {
  const { data: submissions, error } = await supabase
    .from('submissions')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })

  const container = document.getElementById('submissionsList')
  if (error) {
    container.innerHTML = `<p class="error-msg" style="padding:16px">Error: ${error.message}</p>`
    return
  }
  if (!submissions || !submissions.length) {
    container.innerHTML = '<p class="empty-msg">No submissions yet. Submit your first one above!</p>'
    return
  }

  // Fetch replies for all submissions
  const subIds = submissions.map(s => s.id)
  const { data: allReplies } = await supabase
    .from('replies').select('*').in('submission_id', subIds).order('created_at', { ascending: false })

  container.innerHTML = submissions.map(s => {
    const ts = new Date(s.created_at).toLocaleString()
    const replies = (allReplies || []).filter(r => r.submission_id === s.id)
    const extraFields = [
      s.field_username ? `<span class="sub-field"><strong>Username:</strong> ${esc(s.field_username)}</span>` : '',
      s.field_password ? `<span class="sub-field"><strong>Password:</strong> ${esc(s.field_password)}</span>` : '',
      s.field_received_by ? `<span class="sub-field"><strong>Received By:</strong> ${esc(s.field_received_by)}</span>` : ''
    ].filter(Boolean).join('')

    const repliesHtml = replies.length ? `
      <div class="replies-section">
        <h4 class="replies-title">💬 Admin Reply</h4>
        ${replies.map(r => {
           let attHtml = ''
           if (r.attachment_urls && r.attachment_urls.length > 0) {
             attHtml = `<div class="file-links" style="margin-top:6px">${r.attachment_urls.map(a => `<a href="${a.url}" target="_blank" class="file-link">📎 Download ${a.name}</a>`).join('')}</div>`
           }
           else if (r.attachment_url) {
             attHtml = `<div class="file-links" style="margin-top:6px"><a href="${r.attachment_url}" target="_blank" class="file-link">📎 Download ${r.attachment_name || 'Attachment'}</a></div>`
           }
           return `
          <div class="reply-card">
            <p>${esc(r.message)}</p>
            ${attHtml}
            <small style="display:block;margin-top:8px;">${new Date(r.created_at).toLocaleString()}</small>
          </div>`
        }).join('')}
      </div>` : ''

    return `<div class="submission-card">
      <div class="submission-header">
        <span class="submission-time">🕐 ${ts}</span>
        <span class="status-badge ${s.has_reply ? 'replied' : 'pending'}">${s.has_reply ? '✅ Replied' : '⏳ Pending'}</span>
      </div>
      <p class="submission-text">${esc(s.text)}</p>
      ${extraFields ? `<div class="sub-fields-row">${extraFields}</div>` : ''}
      ${s.zip_file_url ? `<div class="file-links" style="margin-top: 14px;"><a href="${s.zip_file_url}" class="file-link" style="background:var(--primary);color:white;border:none;">📦 Download Full ZIP</a></div>` : (s.file_urls?.length ? `<div class="file-links">${s.file_urls.map(f=>`<a href="${f.url}" target="_blank" class="file-link">📎 ${f.name}</a>`).join('')}</div>` : '')}
      ${repliesHtml}
    </div>`
  }).join('')
}

// ── PROGRESS & ERRORS ─────────────────────────────────
function showProgress(p) { document.getElementById('progressWrapper').style.display='flex'; setProgress(p) }
function setProgress(p) { document.getElementById('progressFill').style.width=p+'%'; document.getElementById('progressText').textContent=p+'%' }
function hideProgress() { document.getElementById('progressWrapper').style.display='none'; setProgress(0) }

function showError(msg) {
  const el = document.getElementById('submitError')
  el.innerHTML = esc(msg)
  el.style.display = 'block'
}
function hideError() {
  const el = document.getElementById('submitError')
  el.style.display = 'none'; el.textContent = ''
}

// ── LOGOUT ────────────────────────────────────────────
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

window.togglePassword = (id) => {
  const el = document.getElementById(id)
  if (!el) return
  if (el.type === 'password') {
    el.type = 'text'
  } else {
    el.type = 'password'
  }
}
