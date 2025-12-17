/**
 * This is a new file.
 * It injects your organization's brand colors into Tailwind's utility classes.
 * We will load this in `base.html`.
 */
tailwind.config = {
  theme: {
    extend: {
      colors: {
        // Your RTA brand colors
        primary: {
          DEFAULT: '#171c8f', // Your main RTA blue
          'hover': '#11156a', // A darker shade for hover
        },
        secondary: {
          DEFAULT: '#00B0B9', // Your RTA cyan
          'hover': '#008c94', // A darker shade for hover
        },
        danger: {
          DEFAULT: '#ee0000', // Your RTA red
        },
      },
      fontFamily: {
        // Use Inter as the default, modern font
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
};