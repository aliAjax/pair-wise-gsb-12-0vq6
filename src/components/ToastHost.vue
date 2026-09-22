<script setup lang="ts">
import { useToast } from "./toast";

const toast = useToast();
</script>

<template>
  <div class="toast-host">
    <transition-group name="toast">
      <div v-for="t in toast.items" :key="t.id" class="toast" :class="`toast-${t.type}`">
        {{ t.message }}
      </div>
    </transition-group>
  </div>
</template>
