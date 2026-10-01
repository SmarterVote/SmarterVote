<script lang="ts">
  export let subject: string;
  export let label = "Email Smarter.Vote";
  export let intro = "Contact Smarter.Vote LLC at";

  const email = "SmarterDotVote@gmail.com";
  $: href = `mailto:${email}?subject=${encodeURIComponent(subject)}`;
</script>

<div
  class="card border-l-4 border-l-primary-600 p-4 sm:p-6 dark:border-l-primary-400"
>
  <p class="text-content">
    {intro}
    <a class="font-medium text-primary underline hover:no-underline" {href}
      >{email}</a
    >.
  </p>
  <a class="btn-primary mt-4" {href}>{label}</a>
</div>
