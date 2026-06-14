package com.example.tautracker.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tautracker.core.security.SecureStorage
import com.example.tautracker.data.remote.MoodleAssignment
import com.example.tautracker.data.remote.MoodleCourse
import com.example.tautracker.domain.repository.CourseRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class DashboardUiState(
    val isLoading: Boolean = false,
    val courses: List<MoodleCourse> = emptyList(),
    val assignments: List<MoodleAssignment> = emptyList(),
    val error: String? = null
)

class DashboardViewModel(
    private val repository: CourseRepository,
    private val secureStorage: SecureStorage
) : ViewModel() {

    private val _uiState = MutableStateFlow(DashboardUiState())
    val uiState: StateFlow<DashboardUiState> = _uiState.asStateFlow()

    fun loadData() {
        val token = secureStorage.getToken()
        if (token.isNullOrEmpty()) {
            _uiState.value = _uiState.value.copy(error = "No Moodle Token Found. Please login.")
            return
        }

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            try {
                val courses = repository.getEnrolledCourses(token)
                val assignments = repository.getPendingAssignments(token)
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    courses = courses,
                    assignments = assignments
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = e.localizedMessage ?: "Unknown error occurred"
                )
            }
        }
    }
}
