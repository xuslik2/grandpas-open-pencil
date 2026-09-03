<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { login } from '@/app/hosted/auth/store'
import { HostedApiError } from '@/app/hosted/auth/api'

const router = useRouter()
const email = ref('')
const password = ref('')
const error = ref<string | null>(null)
const submitting = ref(false)

async function onSubmit() {
  error.value = null
  submitting.value = true
  try {
    await login(email.value, password.value)
    router.push('/')
  } catch (err) {
    error.value =
      err instanceof HostedApiError && err.status === 401
        ? 'Incorrect email or password.'
        : 'Could not sign in. Try again.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-screen">
    <form class="login-card" @submit.prevent="onSubmit">
      <h1>Grandpa's Studio</h1>
      <p class="subtitle">Sign in to your team's workspace</p>

      <label class="field">
        <span>Email</span>
        <input v-model="email" type="email" autocomplete="username" required autofocus />
      </label>

      <label class="field">
        <span>Password</span>
        <input v-model="password" type="password" autocomplete="current-password" required />
      </label>

      <p v-if="error" class="error">{{ error }}</p>

      <button type="submit" :disabled="submitting">
        {{ submitting ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.login-screen {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-canvas);
  color: var(--color-surface);
}

.login-card {
  width: min(340px, 90vw);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 32px;
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 12px;
}

h1 {
  font-size: 18px;
  margin: 0;
}

.subtitle {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--color-muted);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}

.field input {
  background: var(--color-input);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 8px 10px;
  color: inherit;
  font-size: 14px;
}

.field input:focus {
  outline: none;
  border-color: var(--color-panel-focus);
}

.error {
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--color-error-bg);
  border: 1px solid var(--color-error-border);
  color: var(--color-error);
  font-size: 13px;
}

button {
  margin-top: 8px;
  padding: 10px;
  border: none;
  border-radius: 6px;
  background: var(--color-accent);
  color: white;
  font-size: 14px;
  cursor: pointer;
}

button:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
