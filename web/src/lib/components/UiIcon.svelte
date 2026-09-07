<script lang="ts">
  export let name:
    | "arrow-right"
    | "arrow-left"
    | "chevron-down"
    | "external"
    | "close"
    | "compare";
  export let size: "sm" | "md" = "md";
</script>

<span class="ui-icon ui-icon--{name} ui-icon--{size}" aria-hidden="true"></span>

<style>
  .ui-icon {
    position: relative;
    display: inline-block;
    flex: 0 0 auto;
    color: currentColor;
  }

  .ui-icon--sm {
    width: 0.75rem;
    height: 0.75rem;
  }

  .ui-icon--md {
    width: 1rem;
    height: 1rem;
  }

  .ui-icon--arrow-right::before,
  .ui-icon--arrow-left::before {
    content: "";
    position: absolute;
    top: 50%;
    right: 8%;
    left: 8%;
    height: 1.5px;
    border-radius: 999px;
    background: currentColor;
    transform: translateY(-50%);
  }

  .ui-icon--arrow-right::after,
  .ui-icon--arrow-left::after,
  .ui-icon--chevron-down::after {
    content: "";
    position: absolute;
    width: 48%;
    height: 48%;
    border-top: 1.5px solid currentColor;
    border-right: 1.5px solid currentColor;
  }

  .ui-icon--arrow-right::after {
    top: 26%;
    right: 8%;
    transform: rotate(45deg);
  }

  .ui-icon--arrow-left::after {
    top: 26%;
    left: 8%;
    transform: rotate(-135deg);
  }

  .ui-icon--chevron-down::after {
    top: 15%;
    left: 26%;
    transform: rotate(135deg);
  }

  .ui-icon--external {
    border-bottom: 1.5px solid currentColor;
    border-left: 1.5px solid currentColor;
    border-radius: 0 0 0 2px;
    transform: scale(0.72);
    transform-origin: bottom left;
  }

  .ui-icon--external::before {
    content: "";
    position: absolute;
    width: 58%;
    height: 58%;
    top: 0;
    right: 0;
    border-top: 1.5px solid currentColor;
    border-right: 1.5px solid currentColor;
  }

  .ui-icon--external::after {
    content: "";
    position: absolute;
    width: 65%;
    height: 1.5px;
    top: 28%;
    right: 9%;
    border-radius: 999px;
    background: currentColor;
    transform: rotate(-45deg);
    transform-origin: right center;
  }

  .ui-icon--close::before,
  .ui-icon--close::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 8%;
    width: 84%;
    height: 1.5px;
    border-radius: 999px;
    background: currentColor;
  }

  .ui-icon--close::before {
    transform: rotate(45deg);
  }

  .ui-icon--close::after {
    transform: rotate(-45deg);
  }

  .ui-icon--compare::before,
  .ui-icon--compare::after {
    content: "";
    position: absolute;
    top: 8%;
    bottom: 8%;
    width: 34%;
    border: 1.5px solid currentColor;
    border-radius: 2px;
  }

  .ui-icon--compare::before {
    left: 4%;
  }

  .ui-icon--compare::after {
    right: 4%;
  }
</style>
