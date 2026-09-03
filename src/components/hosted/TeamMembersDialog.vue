<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  createInvite,
  listMembers,
  listPendingInvites,
  removeMember,
  revokeInvite,
  updateMemberRole,
  type Member,
  type PendingInvite,
  type TeamRole
} from '@/app/hosted/hierarchy/api'
import { currentTeam } from '@/app/hosted/hierarchy/store'
import { AppDialogBody, AppDialogHeader, AppDialogRoot } from '@/components/ui/dialog'

const open = defineModel<boolean>({ required: true })

const members = ref<Member[]>([])
const pendingInvites = ref<PendingInvite[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const inviteEmail = ref('')
const inviteRole = ref<TeamRole>('editor')
const sendingInvite = ref(false)
const lastInviteUrl = ref<string | null>(null)

// Only admins/owners get invite/remove/role-change actions — everyone
// else sees a read-only roster. Matches what the backend actually
// enforces (server-side, not just hidden here) so the UI doesn't offer
// actions that would just 403.
const canManage = computed(
  () => currentTeam.value?.role === 'admin' || currentTeam.value?.role === 'owner'
)
const isOwner = computed(() => currentTeam.value?.role === 'owner')
const ownerCount = computed(() => members.value.filter((m) => m.role === 'owner').length)

async function load() {
  if (!currentTeam.value) return
  loading.value = true
  error.value = null
  try {
    const teamId = currentTeam.value.id
    const [m, i] = await Promise.all([listMembers(teamId), listPendingInvites(teamId)])
    members.value = m
    pendingInvites.value = i
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

watch(open, (isOpen) => {
  if (isOpen) {
    lastInviteUrl.value = null
    void load()
  }
})

async function changeRole(member: Member, role: TeamRole) {
  if (!currentTeam.value) return
  error.value = null
  try {
    await updateMemberRole(currentTeam.value.id, member.id, role)
    member.role = role
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function remove(member: Member) {
  if (!currentTeam.value) return
  error.value = null
  try {
    await removeMember(currentTeam.value.id, member.id)
    members.value = members.value.filter((m) => m.id !== member.id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function sendInvite() {
  if (!currentTeam.value || !inviteEmail.value.trim()) return
  sendingInvite.value = true
  error.value = null
  lastInviteUrl.value = null
  try {
    const { inviteUrl } = await createInvite(
      currentTeam.value.id,
      inviteEmail.value.trim(),
      inviteRole.value
    )
    lastInviteUrl.value = new URL(inviteUrl, location.origin).toString()
    inviteEmail.value = ''
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    sendingInvite.value = false
  }
}

async function revoke(invite: PendingInvite) {
  if (!currentTeam.value) return
  await revokeInvite(currentTeam.value.id, invite.id)
  pendingInvites.value = pendingInvites.value.filter((i) => i.id !== invite.id)
}

async function copyInviteUrl() {
  if (lastInviteUrl.value) await navigator.clipboard.writeText(lastInviteUrl.value)
}
</script>

<template>
  <AppDialogRoot v-model:open="open" size="md" height="tall" data-test-id="team-members-dialog">
    <AppDialogHeader
      :heading="`Manage ${currentTeam?.name ?? 'team'}`"
      description="Members and invitations for this team."
      close-label="Close"
    />
    <AppDialogBody class="flex flex-col gap-5 text-xs">
      <p v-if="error" class="text-danger" role="alert">{{ error }}</p>

      <section>
        <h3 class="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">Members</h3>
        <div v-if="loading" class="text-muted">Loading…</div>
        <div v-else class="flex flex-col gap-1">
          <div
            v-for="member in members"
            :key="member.id"
            class="flex items-center gap-2 rounded px-1.5 py-1.5 hover:bg-hover"
          >
            <span
              class="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white"
              :style="{ backgroundColor: member.avatar_color }"
            >
              {{ member.display_name.slice(0, 1).toUpperCase() }}
            </span>
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">{{ member.display_name }}</p>
              <p class="truncate text-[10px] text-muted">{{ member.email }}</p>
            </div>
            <select
              v-if="isOwner"
              :value="member.role"
              class="rounded border border-border bg-input px-1.5 py-1 text-[11px]"
              :disabled="member.role === 'owner' && ownerCount <= 1"
              @change="changeRole(member, ($event.target as HTMLSelectElement).value as TeamRole)"
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </select>
            <span v-else class="rounded bg-panel-field px-1.5 py-1 text-[11px] capitalize">
              {{ member.role }}
            </span>
            <button
              v-if="canManage"
              type="button"
              class="flex size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-danger disabled:pointer-events-none disabled:opacity-30"
              :disabled="member.role === 'owner' && ownerCount <= 1"
              aria-label="Remove member"
              @click="remove(member)"
            >
              <icon-lucide-x class="size-3.5" />
            </button>
          </div>
        </div>
      </section>

      <section v-if="pendingInvites.length">
        <h3 class="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
          Pending invites
        </h3>
        <div class="flex flex-col gap-1">
          <div
            v-for="invite in pendingInvites"
            :key="invite.id"
            class="flex items-center gap-2 rounded px-1.5 py-1.5 hover:bg-hover"
          >
            <icon-lucide-mail class="size-3.5 shrink-0 text-muted" />
            <div class="min-w-0 flex-1">
              <p class="truncate">{{ invite.email }}</p>
            </div>
            <span class="rounded bg-panel-field px-1.5 py-1 text-[11px] capitalize">
              {{ invite.role }}
            </span>
            <button
              v-if="canManage"
              type="button"
              class="flex size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-danger"
              aria-label="Revoke invite"
              @click="revoke(invite)"
            >
              <icon-lucide-x class="size-3.5" />
            </button>
          </div>
        </div>
      </section>

      <section v-if="canManage">
        <h3 class="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
          Invite someone
        </h3>
        <form class="flex items-center gap-1.5" @submit.prevent="sendInvite">
          <input
            v-model="inviteEmail"
            type="email"
            required
            placeholder="email@example.com"
            class="min-w-0 flex-1 rounded border border-border bg-input px-2 py-1.5 text-xs"
          />
          <select
            v-model="inviteRole"
            class="rounded border border-border bg-input px-1.5 py-1.5 text-xs"
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="submit"
            class="rounded bg-accent px-2.5 py-1.5 text-xs text-white disabled:opacity-60"
            :disabled="sendingInvite || !inviteEmail.trim()"
          >
            Invite
          </button>
        </form>

        <div
          v-if="lastInviteUrl"
          class="mt-2 flex items-center gap-1.5 rounded border border-border bg-panel-field px-2 py-1.5"
        >
          <p class="min-w-0 flex-1 truncate text-[11px] text-muted">{{ lastInviteUrl }}</p>
          <button
            type="button"
            class="shrink-0 rounded border border-border px-2 py-1 text-[11px] hover:bg-hover"
            @click="copyInviteUrl"
          >
            Copy
          </button>
        </div>
        <p v-if="lastInviteUrl" class="mt-1 text-[10px] text-muted">
          No email is sent yet — share this link with them directly.
        </p>
      </section>
    </AppDialogBody>
  </AppDialogRoot>
</template>
