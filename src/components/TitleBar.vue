<template>
  <div class="title-bar">
    <slot />
  </div>
</template>

<style scoped>
.title-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  min-height: 46px;
  flex-shrink: 0;
}

.title-bar :deep(.heading) {
  font-size: 13px;
  font-weight: 600;
}

.title-bar :deep(.hint) {
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title-bar :deep(.spacer) {
  flex: 1;
}

.title-bar :deep(.material-icons) {
  vertical-align: 0;
}

.title-bar :deep(button) {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

@media screen and (max-width: 750px) {
  .title-bar :deep(.btn-label) {
    display: none;
  }
}
</style>
