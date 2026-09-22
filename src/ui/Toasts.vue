<script setup lang="ts">
import { toasts } from "./toast";
</script>

<template>
  <div class="toast-stack">
    <transition-group name="toast">
      <div v-for="item in toasts" :key="item.id" class="toast" :class="item.type">
        {{ item.type === "success" ? "✓" : "✕" }} {{ item.text }}
      </div>
    </transition-group>
  </div>
</template>
