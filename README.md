# Raymond Yu's Academic Website

A Jekyll-based academic website showcasing research, publications, and professional information.

## Local Development Setup

### Prerequisites

1. **Ruby** (version 2.6 or higher)
   - Check if installed: `ruby --version`
   - On macOS: Ruby comes pre-installed, but you may want to use a version manager like `rbenv` or `rvm`
   - On Windows: Install from [RubyInstaller](https://rubyinstaller.org/)
   - On Linux: `sudo apt-get install ruby-full` (Ubuntu/Debian) or equivalent

2. **Bundler** (Ruby gem manager)
   ```bash
   gem install bundler
   ```

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/raymondyu5/raymondyu5.github.io.git
   cd raymondyu5.github.io
   ```

2. **Install dependencies**
   ```bash
   bundle install
   ```

3. **Run the site locally**
   ```bash
   bundle exec jekyll serve --livereload
   ```

4. **View the website**
   - Open your browser to `http://127.0.0.1:4000` or `http://localhost:4000`
   - The site will automatically refresh when you make changes (thanks to `--livereload`)

## Development Commands

### Basic Commands
```bash
# Install/update gems
bundle install
bundle update

# Serve the site locally
bundle exec jekyll serve

# Serve with live reload (recommended for development)
bundle exec jekyll serve --livereload

# Build the site (generates _site/ folder)
bundle exec jekyll build

# Clean build artifacts
bundle exec jekyll clean
```

### Useful Options
```bash
# Run on a different port
bundle exec jekyll serve --port 4001

# Skip initial build for faster startup
bundle exec jekyll serve --skip-initial-build

# Show verbose output for debugging
bundle exec jekyll serve --verbose

# Serve drafts (if you have _drafts/ folder)
bundle exec jekyll serve --drafts
```

## Project Structure

```
raymondyu5.github.io/
├── _config.yml              # Site configuration
├── _data/                   # Data files (YAML/JSON)
│   ├── main_info.yaml       # Personal information
│   ├── publications.yaml    # Publication list
│   ├── projects.yaml        # Projects (currently unused)
│   └── experience.yaml      # Work/education experience
├── _includes/               # Reusable components
│   └── google_analytics.html
├── _layouts/                # Page templates
│   ├── default.html         # Main layout
│   └── project.html         # Project page layout
├── assets/                  # Images, PDFs, etc.
│   ├── profile-pics/
│   └── publications/
├── libs/                    # CSS/JS libraries
│   ├── custom/              # Custom styles/scripts
│   └── external/            # Third-party libraries
├── index.html               # Homepage
├── Gemfile                  # Ruby dependencies
└── README.md                # This file
```

## Customization

### Adding Publications
Edit `_data/publications.yaml`:
```yaml
papers:
  - title: "Your Paper Title"
    authors: "You, Coauthor"
    venue: "Conference/Journal Name"
    paper_pdf: "link-to-paper"
    website: "project-website"
    code: "github-repo"
    image: "/assets/publications/your-image.png"
    selected: y  # Show on main page
```

### Updating Personal Info
Edit `_data/main_info.yaml`:
```yaml
name: "Your Name"
title: "Your Title"
email: "your.email@domain.com"
profile_pic: "/assets/profile-pics/your-photo.jpg"
# ... social media links
```

### Modifying Content
- **Bio/About:** Edit the bio section in `index.html`
- **News:** Update the news section in `index.html`
- **Styling:** Modify `libs/custom/my_css.css`

## Troubleshooting

### Common Issues

1. **Bundle install fails**
   ```bash
   # Try updating RubyGems first
   gem update --system
   bundle install
   ```

2. **Jekyll serve fails**
   ```bash
   # Clean and rebuild
   bundle exec jekyll clean
   bundle exec jekyll serve
   ```

3. **Permission errors on macOS**
   ```bash
   # If you get permission errors, consider using rbenv
   # instead of system Ruby
   brew install rbenv
   rbenv install 3.0.0
   rbenv global 3.0.0
   ```

4. **Port already in use**
   ```bash
   # Use a different port
   bundle exec jekyll serve --port 4001
   ```

### Dependencies Issues

If you encounter issues with native extensions or conflicting gem versions:

1. **Clean everything**
   ```bash
   bundle clean --force
   rm Gemfile.lock
   bundle install
   ```

2. **Use specific Ruby version**
   - This site works best with Ruby 2.6-3.0
   - Consider using `rbenv` or `rvm` to manage Ruby versions

## Deployment

This site is designed to work with GitHub Pages. Simply push changes to the `main` branch and GitHub will automatically build and deploy the site.

### GitHub Pages Notes
- The `Gemfile` uses the `github-pages` gem for compatibility
- GitHub Pages has specific gem versions - the `github-pages` gem ensures compatibility
- Some Jekyll features may be limited on GitHub Pages

## Need Help?

- [Jekyll Documentation](https://jekyllrb.com/docs/)
- [GitHub Pages Documentation](https://docs.github.com/en/pages)
- [Bundler Documentation](https://bundler.io/docs.html)

---

Last updated: December 2025
