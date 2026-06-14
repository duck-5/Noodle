package com.example.tautracker.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tautracker.data.local.entity.AssignmentEntity
import com.example.tautracker.data.local.entity.CourseEntity
import com.example.tautracker.data.repository.SyncRepository
import com.example.tautracker.core.security.SecureStorage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch

data class DashboardUiState(
    val isLoading: Boolean = false,
    val courses: List<CourseEntity> = emptyList(),
    val assignments: List<AssignmentEntity> = emptyList(),
    val error: String? = null
)

class DashboardViewModel(
    private val repository: SyncRepository,
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
                // Trigger sync
                repository.syncCoursesAndAssignments(token)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(error = e.localizedMessage ?: "Unknown error occurred")
            } finally {
                _uiState.value = _uiState.value.copy(isLoading = false)
            }
        }
        
        repository.getVisibleCourses().onEach { courses ->
            _uiState.value = _uiState.value.copy(courses = courses)
        }.launchIn(viewModelScope)

        repository.getAllAssignments().onEach { assignments ->
            _uiState.value = _uiState.value.copy(assignments = assignments)
        }.launchIn(viewModelScope)
    }
}
