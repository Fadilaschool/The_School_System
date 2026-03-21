// Profile management functionality

class ProfileManager {
    constructor() {
        this.currentProfile = null;
        this.isLoading = false;
        this.init();
    }

    init() {
        // Check authentication
        if (!requireAuth()) {
            return;
        }

        // Load profile data
        this.loadProfile();

        // Setup event listeners
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Profile form submission
        const profileForm = document.getElementById('profileForm');
        if (profileForm) {
            profileForm.addEventListener('submit', (e) => this.handleProfileSubmit(e));
        }

        // Profile picture change
        const changePhotoBtn = document.getElementById('changePhotoBtn');
        const photoInput = document.getElementById('photoInput');
        
        if (changePhotoBtn && photoInput) {
            changePhotoBtn.addEventListener('click', () => {
                photoInput.click();
            });

            photoInput.addEventListener('change', (e) => this.handleProfilePictureChange(e));
        }

        // Preferences save
        const savePreferencesBtn = document.getElementById('savePreferencesBtn');
        if (savePreferencesBtn) {
            savePreferencesBtn.addEventListener('click', () => this.savePreferences());
        }

        // Change password button
        const changePasswordBtn = document.getElementById('changePasswordBtn');
        if (changePasswordBtn) {
            changePasswordBtn.addEventListener('click', () => this.showChangePasswordModal());
        }

        // Language selector sync
        const languageSelector = document.getElementById('languageSelector');
        const languagePreference = document.getElementById('languagePreference');
        
        if (languageSelector && languagePreference) {
            languageSelector.addEventListener('change', (e) => {
                const lang = e.target.value;
                languagePreference.value = lang;
                if (typeof setLanguage === 'function') {
                    setLanguage(lang);
                }
            });
            
            languagePreference.addEventListener('change', (e) => {
                const lang = e.target.value;
                languageSelector.value = lang;
                if (typeof setLanguage === 'function') {
                    setLanguage(lang);
                }
            });
        }
    }

    async loadProfile() {
        try {
            this.showLoading(true);
            
            // Use window.API_SERVICES or fallback to API_SERVICES
            const apiServices = (typeof window !== 'undefined' && window.API_SERVICES) ? window.API_SERVICES : API_SERVICES;
            const response = await authManager.makeAuthenticatedRequest(`${apiServices.users}/profile`);
            
            if (!response.ok) {
                if (response.status === 404) {
                    // Use window.Utils or fallback to Utils
                    const utils = (typeof window !== 'undefined' && window.Utils) ? window.Utils : Utils;
                    utils.showNotification('No employee profile found for your user account. Please contact an administrator.', 'error');
                    this.showLoading(false);
                    return;
                }
                throw new Error('Failed to load profile');
            }

            this.currentProfile = await response.json();
            this.populateProfileData();
            this.showLoading(false);
            
        } catch (error) {
            console.error('Error loading profile:', error);
            // Use window.Utils or fallback to Utils
            const utils = (typeof window !== 'undefined' && window.Utils) ? window.Utils : Utils;
            utils.showNotification('Failed to load profile data', 'error');
            this.showLoading(false);
        }
    }

    populateProfileData() {
        if (!this.currentProfile) return;

        const profile = this.currentProfile;

        // Update display elements
        this.updateElement('profileName', `${profile.first_name || ''} ${profile.last_name || ''}`);
        this.updateElement('profileRole', profile.role?.replace('_', ' ') || 'Employee');
        this.updateElement('profileDepartment', profile.department || '');
        this.updateElement('profileEmail', profile.email || '');
        this.updateElement('profilePhone', profile.phone || 'Not provided');
        const utils = (typeof window !== 'undefined' && window.Utils) ? window.Utils : Utils;
        this.updateElement('profileJoinDate', profile.join_date ? utils.formatDate(profile.join_date) : 'Not specified');
        this.updateElement('userDisplayName', `${profile.first_name || ''} ${profile.last_name || ''}`);

        // Update form fields
        this.updateFormField('firstName', profile.first_name);
        this.updateFormField('lastName', profile.last_name);
        this.updateFormField('email', profile.email);
        this.updateFormField('phone', profile.phone);
        this.updateFormField('birthDate', profile.birth_date);
        this.updateFormField('gender', profile.gender);
        this.updateFormField('nationality', profile.nationality);
        this.updateFormField('maritalStatus', profile.marital_status);
        this.updateFormField('address', profile.address);

        // Update preferences
        this.updateFormField('languagePreference', profile.language_preference || 'ar');
        this.updateFormField('themePreference', profile.theme_preference || 'light');

        // Update language selector to match preference
        const languageSelector = document.getElementById('languageSelector');
        if (languageSelector) {
            languageSelector.value = profile.language_preference || 'ar';
        }

        // Update notification preferences
        if (profile.notification_preferences) {
            const prefs = typeof profile.notification_preferences === 'string' 
                ? JSON.parse(profile.notification_preferences) 
                : profile.notification_preferences;
            
            this.updateCheckbox('emailNotifications', prefs.email);
            this.updateCheckbox('pushNotifications', prefs.push);
            this.updateCheckbox('smsNotifications', prefs.sms);
        }

        // Update profile pictures
        this.updateProfilePictures();
    }

    updateElement(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value || '';
        }
    }

    updateFormField(id, value) {
        const field = document.getElementById(id);
        if (field) {
            field.value = value || '';
        }
    }

    updateCheckbox(id, checked) {
        const checkbox = document.getElementById(id);
        if (checkbox) {
            checkbox.checked = !!checked;
        }
    }

    async updateProfilePictures() {
        if (!this.currentProfile) return;

        const profileImage = document.getElementById('profileImage');
        const headerProfileImage = document.getElementById('headerProfileImage');

        if (this.currentProfile.profile_picture_url) {
            try {
                const apiServices = (typeof window !== 'undefined' && window.API_SERVICES) ? window.API_SERVICES : API_SERVICES;
                const imageUrl = `${apiServices.users}/profile-image/${this.currentProfile.id}`;
                
                // Test if the image loads successfully
                const testImage = new Image();
                testImage.onload = () => {
                    if (profileImage) profileImage.src = imageUrl;
                    if (headerProfileImage) headerProfileImage.src = imageUrl;
                };
                testImage.onerror = () => {
                    this.setPlaceholderImages();
                };
                testImage.src = imageUrl;
                
            } catch (error) {
                console.error('Error loading profile image:', error);
                this.setPlaceholderImages();
            }
        } else {
            this.setPlaceholderImages();
        }
    }

    setPlaceholderImages() {
        const profileImage = document.getElementById('profileImage');
        const headerProfileImage = document.getElementById('headerProfileImage');
        
        const initials = this.getInitials();
        const placeholderUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(initials)}&background=3b82f6&color=ffffff&size=150`;
        
        if (profileImage) profileImage.src = placeholderUrl;
        if (headerProfileImage) headerProfileImage.src = placeholderUrl;
    }

    getInitials() {
        if (!this.currentProfile) return 'U';
        
        const firstName = this.currentProfile.first_name || '';
        const lastName = this.currentProfile.last_name || '';
        
        return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || 'U';
    }

    async handleProfileSubmit(e) {
        e.preventDefault();
        
        if (this.isLoading) return;

        try {
            this.setSubmitLoading(true);

            const formData = new FormData(e.target);
            
            // Convert FormData to regular object for JSON
            const profileData = {};
            for (let [key, value] of formData.entries()) {
                profileData[key] = value;
            }

            const apiServices = (typeof window !== 'undefined' && window.API_SERVICES) ? window.API_SERVICES : API_SERVICES;
            const utils = (typeof window !== 'undefined' && window.Utils) ? window.Utils : Utils;
            
            const response = await authManager.makeAuthenticatedRequest(`${apiServices.users}/profile`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(profileData)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to update profile');
            }

            const result = await response.json();
            this.currentProfile = result.profile;
            
            // Update display elements with new data
            this.populateProfileData();
            
            utils.showNotification('Profile updated successfully', 'success');
            
        } catch (error) {
            console.error('Error updating profile:', error);
            const utils = (typeof window !== 'undefined' && window.Utils) ? window.Utils : Utils;
            utils.showNotification(error.message || 'Failed to update profile', 'error');
        } finally {
            this.setSubmitLoading(false);
        }
    }

    async handleProfilePictureChange(e) {
        const file = e.target.files[0];
        if (!file) return;

        const utils = (typeof window !== 'undefined' && window.Utils) ? window.Utils : Utils;
        const apiServices = (typeof window !== 'undefined' && window.API_SERVICES) ? window.API_SERVICES : API_SERVICES;
        
        // Validate file type
        if (!file.type.startsWith('image/')) {
            utils.showNotification('Please select an image file', 'error');
            return;
        }

        // Validate file size (5MB max)
        if (file.size > 5 * 1024 * 1024) {
            utils.showNotification('Image file must be less than 5MB', 'error');
            return;
        }

        try {
            this.setSubmitLoading(true);

            const formData = new FormData();
            formData.append('profile_picture', file);

            const response = await authManager.makeAuthenticatedRequest(`${apiServices.users}/profile/picture`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to upload profile picture');
            }

            const result = await response.json();
            
            // Update current profile data
            if (this.currentProfile) {
                this.currentProfile.profile_picture_url = result.profile_picture_url;
            }
            
            // Update profile pictures
            this.updateProfilePictures();
            
            const utils = (typeof window !== 'undefined' && window.Utils) ? window.Utils : Utils;
            utils.showNotification('Profile picture updated successfully', 'success');
            
        } catch (error) {
            console.error('Error uploading profile picture:', error);
            const utils = (typeof window !== 'undefined' && window.Utils) ? window.Utils : Utils;
            utils.showNotification(error.message || 'Failed to upload profile picture', 'error');
        } finally {
            this.setSubmitLoading(false);
            // Clear the file input
            e.target.value = '';
        }
    }

    async savePreferences() {
        try {
            this.setSubmitLoading(true);

            const preferences = {
                language_preference: document.getElementById('languagePreference')?.value || 'ar',
                theme_preference: document.getElementById('themePreference')?.value || 'light',
                notification_preferences: {
                    email: document.getElementById('emailNotifications')?.checked || false,
                    push: document.getElementById('pushNotifications')?.checked || false,
                    sms: document.getElementById('smsNotifications')?.checked || false
                }
            };

            const apiServices = (typeof window !== 'undefined' && window.API_SERVICES) ? window.API_SERVICES : API_SERVICES;
            const utils = (typeof window !== 'undefined' && window.Utils) ? window.Utils : Utils;
            
            const response = await authManager.makeAuthenticatedRequest(`${apiServices.users}/profile`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(preferences)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to save preferences');
            }

            const result = await response.json();
            this.currentProfile = result.profile;
            
            // Update language selector and apply language change
            const languageSelector = document.getElementById('languageSelector');
            if (languageSelector) {
                languageSelector.value = preferences.language_preference;
            }
            
            // Apply language change immediately
            if (typeof setLanguage === 'function') {
                setLanguage(preferences.language_preference);
            }
            
            utils.showNotification('Preferences saved successfully', 'success');
            
        } catch (error) {
            console.error('Error saving preferences:', error);
            const utils = (typeof window !== 'undefined' && window.Utils) ? window.Utils : Utils;
            utils.showNotification(error.message || 'Failed to save preferences', 'error');
        } finally {
            this.setSubmitLoading(false);
        }
    }

    showLoading(show) {
        const loadingIndicator = document.getElementById('loadingIndicator');
        const profileContent = document.getElementById('profileContent');
        
        if (loadingIndicator && profileContent) {
            if (show) {
                loadingIndicator.classList.remove('hidden');
                profileContent.classList.add('hidden');
            } else {
                loadingIndicator.classList.add('hidden');
                profileContent.classList.remove('hidden');
            }
        }
    }

    setSubmitLoading(loading) {
        this.isLoading = loading;
        
        const saveButton = document.getElementById('saveButton');
        const saveButtonText = document.getElementById('saveButtonText');
        const savePreferencesBtn = document.getElementById('savePreferencesBtn');
        
        if (saveButton) {
            saveButton.disabled = loading;
            if (loading) {
                saveButton.classList.add('opacity-50', 'cursor-not-allowed');
            } else {
                saveButton.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        }
        
        if (saveButtonText) {
            saveButtonText.textContent = loading ? 'Saving...' : 'Save Changes';
        }
        
        if (savePreferencesBtn) {
            savePreferencesBtn.disabled = loading;
            if (loading) {
                savePreferencesBtn.classList.add('opacity-50', 'cursor-not-allowed');
                savePreferencesBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';
            } else {
                savePreferencesBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                savePreferencesBtn.innerHTML = '<i class="fas fa-save mr-2"></i>Save Preferences';
            }
        }
    }

    showChangePasswordModal() {
        const modal = document.getElementById('changePasswordModal');
        const form = document.getElementById('changePasswordForm');
        const errorDiv = document.getElementById('passwordError');
        const errorText = document.getElementById('passwordErrorText');
        
        if (modal) {
            modal.classList.remove('hidden');
            if (form) {
                form.reset();
            }
            if (errorDiv) {
                errorDiv.classList.add('hidden');
            }
        }

        // Setup form submit handler
        if (form && !form.dataset.handlerAdded) {
            form.addEventListener('submit', (e) => this.handleChangePassword(e));
            form.dataset.handlerAdded = 'true';
        }
    }

    closeChangePasswordModal() {
        const modal = document.getElementById('changePasswordModal');
        const form = document.getElementById('changePasswordForm');
        const errorDiv = document.getElementById('passwordError');
        
        if (modal) {
            modal.classList.add('hidden');
        }
        if (form) {
            form.reset();
        }
        if (errorDiv) {
            errorDiv.classList.add('hidden');
        }
    }

    async handleChangePassword(e) {
        e.preventDefault();
        
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const errorDiv = document.getElementById('passwordError');
        const errorText = document.getElementById('passwordErrorText');
        const submitBtn = document.getElementById('submitPasswordBtn');
        const submitBtnText = document.getElementById('submitPasswordBtnText');

        // Hide error initially
        if (errorDiv) {
            errorDiv.classList.add('hidden');
        }

        // Validate passwords match
        if (newPassword !== confirmPassword) {
            if (errorDiv && errorText) {
                errorText.textContent = 'New password and confirm password do not match';
                errorDiv.classList.remove('hidden');
            }
            return;
        }

        // Validate password length
        if (newPassword.length < 6) {
            if (errorDiv && errorText) {
                errorText.textContent = 'New password must be at least 6 characters long';
                errorDiv.classList.remove('hidden');
            }
            return;
        }

        try {
            // Disable submit button
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
            }
            if (submitBtnText) {
                submitBtnText.textContent = 'Changing...';
            }

            const apiServices = (typeof window !== 'undefined' && window.API_SERVICES) ? window.API_SERVICES : API_SERVICES;
            const utils = (typeof window !== 'undefined' && window.Utils) ? window.Utils : Utils;
            
            const response = await authManager.makeAuthenticatedRequest(`${apiServices.users}/profile/password`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    currentPassword,
                    newPassword
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to change password');
            }

            utils.showNotification('Password changed successfully', 'success');
            this.closeChangePasswordModal();

        } catch (error) {
            console.error('Error changing password:', error);
            const utils = (typeof window !== 'undefined' && window.Utils) ? window.Utils : Utils;
            if (errorDiv && errorText) {
                errorText.textContent = error.message || 'Failed to change password. Please try again.';
                errorDiv.classList.remove('hidden');
            } else {
                utils.showNotification(error.message || 'Failed to change password', 'error');
            }
        } finally {
            // Re-enable submit button
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            }
            if (submitBtnText) {
                submitBtnText.textContent = 'Change Password';
            }
        }
    }
}

// Global function to close modal (for onclick handlers)
window.closeChangePasswordModal = function() {
    if (window.profileManager) {
        window.profileManager.closeChangePasswordModal();
    } else {
        const modal = document.getElementById('changePasswordModal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }
}

// Initialize profile manager when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Only initialize on profile page
    if (window.location.pathname.includes('profile.html')) {
        window.profileManager = new ProfileManager();
    }
});

// Export for global access
window.ProfileManager = ProfileManager;

