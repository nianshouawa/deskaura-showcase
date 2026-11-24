/** Invalidates asynchronous UI work even when a role changes A → B → A. */
export class RoleRequestScope {
  private revision = 0
  capture(roleId: string) { return { roleId, revision: this.revision } }
  invalidate() { this.revision++ }
  accepts(token: { roleId: string; revision: number }, currentRoleId: string) {
    return token.roleId === currentRoleId && token.revision === this.revision
  }
}
