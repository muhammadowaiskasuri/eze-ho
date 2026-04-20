import { supabase, ADMIN_EMAIL } from './supabase-init.js'

// ── TAB TOGGLE ────────────────────────────────────────
window.showLogin = () => {
  document.getElementById('loginForm').style.display = 'block'
  document.getElementById('signupForm').style.display = 'none'
  if(document.getElementById('otpForm')) document.getElementById('otpForm').style.display = 'none'
  document.getElementById('loginTab').classList.add('active')
  document.getElementById('signupTab').classList.remove('active')
}
window.showSignup = () => {
  document.getElementById('loginForm').style.display = 'none'
  document.getElementById('signupForm').style.display = 'block'
  if(document.getElementById('otpForm')) document.getElementById('otpForm').style.display = 'none'
  document.getElementById('loginTab').classList.remove('active')
  document.getElementById('signupTab').classList.add('active')
}

// ── CHECK SESSION ─────────────────────────────────────
;(async () => {
  const { data: { session } } = await supabase.auth.getSession()
  if (session) redirectUser(session.user.email)
})()

function redirectUser(email) {
  window.location.href = email === ADMIN_EMAIL ? 'admin.html' : 'dashboard.html'
}

// ── LOGIN ─────────────────────────────────────────────
window.handleLogin = async (e) => {
  e.preventDefault()
  const email = document.getElementById('loginEmail').value.trim()
  const password = document.getElementById('loginPassword').value
  const btn = document.getElementById('loginBtn')
  const errEl = document.getElementById('loginError')
  errEl.textContent = ''
  btn.textContent = 'Logging in...'
  btn.disabled = true

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    errEl.textContent = friendlyError(error.message)
    btn.textContent = 'Login'
    btn.disabled = false
    return
  }

  // Ensure user profile exists
  await ensureUserProfile(data.user, null)
  redirectUser(data.user.email)
}

// ── SIGNUP ────────────────────────────────────────────
window.handleSignup = async (e) => {
  e.preventDefault()
  const name = document.getElementById('signupName').value.trim()
  const email = document.getElementById('signupEmail').value.trim()
  const password = document.getElementById('signupPassword').value
  const btn = document.getElementById('signupBtn')
  const msgEl = document.getElementById('signupMsg')
  const errEl = document.getElementById('signupError')
  msgEl.textContent = ''
  errEl.textContent = ''
  if (!name) { errEl.textContent = 'Please enter your full name.'; return }
  btn.textContent = 'Creating account...'
  btn.disabled = true

  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) {
    errEl.textContent = friendlyError(error.message)
    btn.textContent = 'Create Account'
    btn.disabled = false
    return
  }

  // If session exists (email confirmation disabled), create profile and redirect
  if (data.session) {
    await ensureUserProfile(data.user, name)
    redirectUser(data.user.email)
    return
  }

  // Email confirmation enabled — save name for later
  localStorage.setItem('pendingName_' + email, name)
  window.currentSignupEmail = email
  
  // Transition UI
  document.getElementById('signupForm').style.display = 'none'
  document.getElementById('otpForm').style.display = 'block'
  
  btn.textContent = 'Create Account'
  btn.disabled = false
}

// ── VERIFY OTP ────────────────────────────────────────
window.verifyOtp = async (e) => {
  e.preventDefault()
  const token = document.getElementById('otpCode').value.trim()
  const email = window.currentSignupEmail
  const btn = document.getElementById('otpBtn')
  const errEl = document.getElementById('otpError')
  errEl.textContent = ''
  
  if (!token) return
  btn.textContent = 'Verifying...'
  btn.disabled = true

  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'signup' })
  
  if (error) {
    errEl.textContent = friendlyError(error.message)
    btn.textContent = 'Verify Account'
    btn.disabled = false
    return
  }

  // Verification successful! Ensure profile and enter dashboard
  if (data.session) {
    const pendingName = localStorage.getItem('pendingName_' + email) || ''
    await ensureUserProfile(data.user, pendingName)
    redirectUser(data.user.email)
  }
}

// ── ENSURE USER PROFILE ───────────────────────────────
async function ensureUserProfile(user, name) {
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  if (!existing) {
    const displayName = name || localStorage.getItem('pendingName_' + user.email) || user.email.split('@')[0]
    await supabase.from('users').insert({
      id: user.id,
      name: displayName,
      email: user.email,
      credits: 0
    })
    localStorage.removeItem('pendingName_' + user.email)
  }
}

// ── FORGOT PASSWORD ───────────────────────────────────
window.openForgotModal = () => {
  document.getElementById('forgotModal').style.display = 'flex'
  document.getElementById('forgotMsg').textContent = ''
  document.getElementById('forgotEmail').value = ''
}
window.closeForgotModal = () => {
  document.getElementById('forgotModal').style.display = 'none'
}
window.sendResetEmail = async () => {
  const email = document.getElementById('forgotEmail').value.trim()
  const msgEl = document.getElementById('forgotMsg')
  if (!email) { msgEl.textContent = 'Please enter your email.'; return }
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/index.html'
  })
  if (error) {
    msgEl.style.color = 'var(--danger)'
    msgEl.textContent = error.message
  } else {
    msgEl.style.color = 'var(--success)'
    msgEl.textContent = 'Reset link sent! Check your inbox.'
    setTimeout(closeForgotModal, 2500)
  }
}

function friendlyError(msg) {
  if (msg.includes('Invalid login credentials')) return 'Invalid email or password.'
  if (msg.includes('Email not confirmed')) return 'Please verify your email first. Check your inbox.'
  if (msg.includes('already registered')) return 'This email is already registered. Please login.'
  if (msg.includes('Password should')) return 'Password must be at least 6 characters.'
  return msg
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
